import { Router } from 'express';
import multer from 'multer';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';
import {
    detectFormat,
    groupByAccount,
    parseFidelityCSV,
} from '../services/csvParserService.js';
import { reconstructHistoryForUser } from '../services/historyReconstructService.js';

const router = Router();

// ─── Multer — memory storage, 5 MB cap, CSV only ─────────────────────────────

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = file.mimetype === 'text/csv'
            || file.mimetype === 'application/vnd.ms-excel'
            || file.originalname.toLowerCase().endsWith('.csv');
        if (ok) return cb(null, true);
        return cb(Object.assign(new Error('Only .csv files are accepted'), { status: 400 }));
    },
});

// ─── Account-name matching (exact → partial → word-intersection) ──────────────

function buildMatcher(accounts) {
    return function matchAccount(csvName) {
        if (!csvName) return null;
        const lower = csvName.toLowerCase().trim();

        // 1. Exact case-insensitive
        let hit = accounts.find((a) => a.name.toLowerCase() === lower);

        // 2. Substring: CSV name contains account name or vice versa
        if (!hit) {
            hit = accounts.find((a) => {
                const aLow = a.name.toLowerCase();
                return lower.includes(aLow) || aLow.includes(lower);
            });
        }

        // 3. Word-level intersection (≥ 3-char words)
        if (!hit) {
            const csvWords = new Set(lower.split(/\W+/).filter((w) => w.length > 2));
            hit = accounts.find((a) => {
                const aWords = a.name.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
                return aWords.some((w) => csvWords.has(w));
            });
        }

        return hit ?? null;
    };
}

// ─── GET /api/import/history ──────────────────────────────────────────────────

router.get('/history', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, filename, format,
                    transactions_imported, snapshots_created,
                    accounts_matched, accounts_unmatched,
                    date_earliest::text AS date_earliest,
                    date_latest::text   AS date_latest,
                    warnings, created_at
             FROM csv_import_log
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [req.user.id]
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// ─── DELETE /api/import/history — clear log only, NOT the imported data ───────

router.delete('/history', requireAuth, async (req, res) => {
    try {
        await query('DELETE FROM csv_import_log WHERE user_id = $1', [req.user.id]);
        return res.json({ cleared: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/import/preview ─────────────────────────────────────────────────
//
// Parse the CSV and return per-account summaries with match information —
// WITHOUT saving anything to the database. The frontend shows a review table
// and the user selects which accounts to import before confirming.

router.post('/preview', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded — send a CSV as multipart/form-data field "file".' });
        }

        const text   = req.file.buffer.toString('utf-8');
        const format = detectFormat(text);

        if (!format) {
            return res.status(422).json({
                error: 'Unrecognised CSV format. Currently only Fidelity account-history exports are supported.',
            });
        }

        const { rows: parsedRows, warnings } = format === 'fidelity'
            ? parseFidelityCSV(text)
            : { rows: [], warnings: [`Format "${format}" detected but no parser available.`] };

        if (!parsedRows.length) {
            return res.status(422).json({
                error: 'No valid transaction rows found in the file.',
                warnings,
            });
        }

        // Group by account name
        const accountGroups = groupByAccount(parsedRows);

        // Load the user's accounts (include include_in_tracking for pre-check logic)
        const acctResult = await query(
            `SELECT id, name, include_in_tracking, fidelity_account_number
             FROM accounts WHERE user_id = $1`,
            [req.user.id]
        );
        const matchAccount = buildMatcher(acctResult.rows);

        // Annotate each group with match information
        const accounts = accountGroups.map((g) => {
            // Prefer matching by fidelity_account_number if available on any existing account
            const byNumber = g.csvAccountNumber
                ? acctResult.rows.find((a) => a.fidelity_account_number === g.csvAccountNumber)
                : null;
            const matched = byNumber || matchAccount(g.csvAccountName);

            return {
                csvAccountName:   g.csvAccountName,
                csvAccountNumber: g.csvAccountNumber,
                transactionCount: g.transactionCount,
                dateRange: {
                    earliest: g.earliest,
                    latest:   g.latest,
                },
                matchedAccount: matched
                    ? {
                        id:                  matched.id,
                        name:                matched.name,
                        include_in_tracking: matched.include_in_tracking,
                    }
                    : null,
            };
        });

        return res.json({
            filename:          req.file.originalname,
            format,
            totalTransactions: parsedRows.length,
            accounts,
            warnings,
        });
    } catch (error) {
        console.error('[import] Preview error:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Preview failed' });
    }
});

// ─── POST /api/import/csv ─────────────────────────────────────────────────────
//
// body (multipart): file + optional selectedAccountNames (JSON string)
// If selectedAccountNames is omitted, all matched accounts are imported.

router.post('/csv', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded — send a CSV as multipart/form-data field "file".' });
        }

        // Parse selectedAccountNames from multipart body field (JSON-encoded array)
        let selectedNames = null; // null = import all matched
        if (req.body?.selectedAccountNames) {
            try {
                selectedNames = new Set(JSON.parse(req.body.selectedAccountNames));
            } catch {
                return res.status(400).json({ error: 'selectedAccountNames must be a JSON array of account name strings.' });
            }
        }

        const text   = req.file.buffer.toString('utf-8');
        const format = detectFormat(text);

        if (!format) {
            return res.status(422).json({
                error: 'Unrecognised CSV format. Currently only Fidelity account-history exports are supported.',
            });
        }

        // Parse the CSV.
        const { rows: parsedRows, warnings } = format === 'fidelity'
            ? parseFidelityCSV(text)
            : { rows: [], warnings: [`Format "${format}" is detected but no parser is available yet.`] };

        if (!parsedRows.length) {
            return res.status(422).json({
                error: 'No valid transaction rows found in the file.',
                warnings,
            });
        }

        // Filter to only selected accounts if the caller passed a selection
        const filteredRows = selectedNames
            ? parsedRows.filter((r) => selectedNames.has(r.accountName))
            : parsedRows;

        if (!filteredRows.length) {
            return res.json({
                transactionsImported: 0,
                snapshotsCreated: 0,
                accountsMatched: 0,
                accountsUnmatched: 0,
                dateRange: { earliest: null, latest: null },
                warnings: [...warnings, 'No rows matched the selected accounts.'],
            });
        }

        // Load the user's accounts for name-matching.
        const acctResult = await query(
            `SELECT id, name, fidelity_account_number FROM accounts WHERE user_id = $1`,
            [req.user.id]
        );
        const matchAccount = buildMatcher(acctResult.rows);

        // Separate matched / unmatched rows.
        const matchedAccountIds = new Set();
        const unmatchedNames    = new Set();
        const matchedRows       = [];

        for (const row of filteredRows) {
            // Prefer matching by fidelity_account_number if stored
            const byNumber = row.accountNumber
                ? acctResult.rows.find((a) => a.fidelity_account_number === row.accountNumber)
                : null;
            const acct = byNumber || matchAccount(row.accountName);

            if (!acct) {
                unmatchedNames.add(row.accountName);
            } else {
                matchedAccountIds.add(acct.id);
                matchedRows.push({ ...row, accountId: acct.id, _acctRow: acct });
            }
        }

        if (unmatchedNames.size) {
            warnings.push(
                `${unmatchedNames.size} account name${unmatchedNames.size === 1 ? '' : 's'} in the CSV did not match any of your accounts: `
                + [...unmatchedNames].slice(0, 5).join(', ')
                + (unmatchedNames.size > 5 ? ` … and ${unmatchedNames.size - 5} more` : '.')
            );
        }

        // Upsert transactions — ON CONFLICT (account_id, external_id) DO NOTHING = idempotent.
        let transactionsImported = 0;
        const importedDates      = [];

        for (const row of matchedRows) {
            const result = await query(
                `INSERT INTO account_transactions
                   (user_id, account_id, external_id, transaction_type,
                    amount, price, units, symbol, currency,
                    transacted_at, description, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'USD', $9, $10, 'csv_import')
                 ON CONFLICT (account_id, external_id) DO NOTHING`,
                [
                    req.user.id,
                    row.accountId,
                    row.external_id,
                    row.transaction_type,
                    row.amount,
                    row.price,
                    row.units,
                    row.symbol,
                    row.transacted_at,
                    row.description,
                ]
            );
            if (result.rowCount > 0) {
                transactionsImported++;
                importedDates.push(row.transacted_at);
            }

            // Back-fill fidelity_account_number on the matched RetireView account if missing.
            if (row.accountNumber && !row._acctRow.fidelity_account_number) {
                await query(
                    `UPDATE accounts SET fidelity_account_number = $1 WHERE id = $2`,
                    [row.accountNumber, row.accountId]
                ).catch(() => {}); // non-fatal
                row._acctRow.fidelity_account_number = row.accountNumber; // prevent repeat updates
            }
        }

        // Reconstruct historical monthly snapshots from the newly-imported transactions.
        // This uses ON CONFLICT DO NOTHING — it will never overwrite snaptrade or
        // user-taken snapshots; it only fills gaps.
        let snapshotsCreated = 0;
        try {
            const recon = await reconstructHistoryForUser(req.user.id);
            snapshotsCreated = recon.monthsReconstructed;
        } catch (reconErr) {
            console.error('[import] Reconstruction failed after CSV import:', reconErr.message);
            warnings.push('History reconstruction encountered an error — snapshot data may be incomplete.');
        }

        const sortedDates = importedDates.sort();
        const dateEarliest = sortedDates[0]    ?? null;
        const dateLatest   = sortedDates.at(-1) ?? null;

        // Persist import log.
        await query(
            `INSERT INTO csv_import_log
               (user_id, filename, format, transactions_imported, snapshots_created,
                accounts_matched, accounts_unmatched, date_earliest, date_latest, warnings)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                req.user.id,
                req.file.originalname,
                format,
                transactionsImported,
                snapshotsCreated,
                matchedAccountIds.size,
                unmatchedNames.size,
                dateEarliest,
                dateLatest,
                JSON.stringify(warnings),
            ]
        );

        return res.json({
            transactionsImported,
            snapshotsCreated,
            accountsMatched:   matchedAccountIds.size,
            accountsUnmatched: unmatchedNames.size,
            dateRange: { earliest: dateEarliest, latest: dateLatest },
            warnings,
        });
    } catch (error) {
        console.error('[import] CSV import error:', error.message);
        // Multer errors (file too large, wrong type) carry a status code.
        return res.status(error.status || 500).json({ error: error.message || 'Import failed' });
    }
});

export default router;
