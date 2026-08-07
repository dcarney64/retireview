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
import { deriveAccountName, parseFidelityPDF } from '../services/pdfParserService.js';

const router = Router();

// ─── Multer — memory storage, 10 MB cap, CSV + PDF ───────────────────────────

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const name = file.originalname.toLowerCase();
        const ok   = file.mimetype === 'text/csv'
            || file.mimetype === 'application/vnd.ms-excel'
            || file.mimetype === 'application/pdf'
            || name.endsWith('.csv')
            || name.endsWith('.pdf');
        if (ok) return cb(null, true);
        return cb(Object.assign(new Error('Only .csv and .pdf files are accepted'), { status: 400 }));
    },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the uploaded file is a PDF (by MIME type or extension). */
function isPDFFile(file) {
    return file.mimetype === 'application/pdf'
        || file.originalname.toLowerCase().endsWith('.pdf');
}

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
// Parse the uploaded file and return per-account summaries with match info —
// WITHOUT saving anything to the database. Supports PDF and CSV.

router.post('/preview', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded — send a file as multipart/form-data field "file".' });
        }

        // ── PDF preview ───────────────────────────────────────────────────────
        if (isPDFFile(req.file)) {
            const pdfResult = await parseFidelityPDF(req.file.buffer);
            const warnings  = [...pdfResult.warnings];

            if (!pdfResult.statementDate) {
                return res.status(422).json({
                    error: 'Could not determine statement date from the PDF. Is this a Fidelity Private Client Group statement?',
                    warnings,
                });
            }

            if (!pdfResult.accounts.length) {
                return res.status(422).json({
                    error: 'No account balances found in PDF.',
                    warnings,
                });
            }

            // Load user's accounts for matching
            const acctResult = await query(
                `SELECT id, name, include_in_tracking, fidelity_account_number
                 FROM accounts WHERE user_id = $1`,
                [req.user.id]
            );
            const matchAccount = buildMatcher(acctResult.rows);

            const accounts = pdfResult.accounts.map((pdfAcct) => {
                // Match by fidelity_account_number first, then by name
                const byNumber = pdfAcct.accountNumber
                    ? acctResult.rows.find((a) => a.fidelity_account_number === pdfAcct.accountNumber)
                    : null;
                const matched = byNumber || matchAccount(pdfAcct.accountName);

                return {
                    accountNumber:    pdfAcct.accountNumber,
                    accountName:      pdfAcct.accountName,
                    accountType:      pdfAcct.accountType,
                    beginningBalance: pdfAcct.beginningBalance,
                    endingBalance:    pdfAcct.endingBalance,
                    matchedAccount:   matched
                        ? { id: matched.id, name: matched.name, include_in_tracking: matched.include_in_tracking }
                        : null,
                };
            });

            return res.json({
                filename:      req.file.originalname,
                format:        'fidelity_pdf',
                statementDate: pdfResult.statementDate,
                totalValue:    pdfResult.totalValue,
                accounts,
                warnings,
            });
        }

        // ── CSV preview ───────────────────────────────────────────────────────
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
            return res.status(422).json({ error: 'No valid transaction rows found in the file.', warnings });
        }

        const accountGroups = groupByAccount(parsedRows);

        const acctResult = await query(
            `SELECT id, name, include_in_tracking, fidelity_account_number
             FROM accounts WHERE user_id = $1`,
            [req.user.id]
        );
        const matchAccount = buildMatcher(acctResult.rows);

        const accounts = accountGroups.map((g) => {
            const byNumber = g.csvAccountNumber
                ? acctResult.rows.find((a) => a.fidelity_account_number === g.csvAccountNumber)
                : null;
            const matched = byNumber || matchAccount(g.csvAccountName);

            return {
                csvAccountName:   g.csvAccountName,
                csvAccountNumber: g.csvAccountNumber,
                transactionCount: g.transactionCount,
                dateRange: { earliest: g.earliest, latest: g.latest },
                matchedAccount: matched
                    ? { id: matched.id, name: matched.name, include_in_tracking: matched.include_in_tracking }
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
// body (multipart):
//   file                   — the CSV or PDF
//   selectedAccountNumbers — JSON string array of account numbers  (PDF path)
//   selectedAccountNames   — JSON string array of account names    (CSV path)
//
// If neither selection field is sent all matched/skippable accounts are imported.

router.post('/csv', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded — send a file as multipart/form-data field "file".' });
        }

        // ── PDF import ────────────────────────────────────────────────────────
        if (isPDFFile(req.file)) {
            return handlePDFImport(req, res);
        }

        // ── CSV import ────────────────────────────────────────────────────────
        let selectedNames = null;
        if (req.body?.selectedAccountNames) {
            try { selectedNames = new Set(JSON.parse(req.body.selectedAccountNames)); }
            catch { return res.status(400).json({ error: 'selectedAccountNames must be a JSON array of strings.' }); }
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
            : { rows: [], warnings: [`Format "${format}" is detected but no parser is available yet.`] };

        if (!parsedRows.length) {
            return res.status(422).json({ error: 'No valid transaction rows found in the file.', warnings });
        }

        const filteredRows = selectedNames
            ? parsedRows.filter((r) => selectedNames.has(r.accountName))
            : parsedRows;

        if (!filteredRows.length) {
            return res.json({
                transactionsImported: 0, snapshotsCreated: 0,
                accountsMatched: 0, accountsUnmatched: 0,
                dateRange: { earliest: null, latest: null },
                warnings: [...warnings, 'No rows matched the selected accounts.'],
            });
        }

        const acctResult = await query(
            `SELECT id, name, fidelity_account_number FROM accounts WHERE user_id = $1`,
            [req.user.id]
        );
        const matchAccount = buildMatcher(acctResult.rows);

        const matchedAccountIds = new Set();
        const unmatchedNames    = new Set();
        const matchedRows       = [];

        for (const row of filteredRows) {
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
                    req.user.id, row.accountId, row.external_id, row.transaction_type,
                    row.amount, row.price, row.units, row.symbol,
                    row.transacted_at, row.description,
                ]
            );
            if (result.rowCount > 0) {
                transactionsImported++;
                importedDates.push(row.transacted_at);
            }

            if (row.accountNumber && !row._acctRow.fidelity_account_number) {
                await query(
                    `UPDATE accounts SET fidelity_account_number = $1 WHERE id = $2`,
                    [row.accountNumber, row.accountId]
                ).catch(() => {});
                row._acctRow.fidelity_account_number = row.accountNumber;
            }
        }

        let snapshotsCreated = 0;
        try {
            const recon = await reconstructHistoryForUser(req.user.id);
            snapshotsCreated = recon.monthsReconstructed;
        } catch (reconErr) {
            console.error('[import] Reconstruction failed after CSV import:', reconErr.message);
            warnings.push('History reconstruction encountered an error — snapshot data may be incomplete.');
        }

        const sortedDates  = importedDates.sort();
        const dateEarliest = sortedDates[0]    ?? null;
        const dateLatest   = sortedDates.at(-1) ?? null;

        await query(
            `INSERT INTO csv_import_log
               (user_id, filename, format, transactions_imported, snapshots_created,
                accounts_matched, accounts_unmatched, date_earliest, date_latest, warnings)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                req.user.id, req.file.originalname, format,
                transactionsImported, snapshotsCreated,
                matchedAccountIds.size, unmatchedNames.size,
                dateEarliest, dateLatest, JSON.stringify(warnings),
            ]
        );

        return res.json({
            transactionsImported, snapshotsCreated,
            accountsMatched: matchedAccountIds.size,
            accountsUnmatched: unmatchedNames.size,
            dateRange: { earliest: dateEarliest, latest: dateLatest },
            warnings,
        });
    } catch (error) {
        console.error('[import] Import error:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Import failed' });
    }
});

// ─── PDF import handler ───────────────────────────────────────────────────────
//
// Parses a Fidelity PDF statement, writes one snapshot for the statement date,
// and writes per-account balances to account_snapshots.
//
// selectedAccountNumbers — JSON array of Fidelity account numbers to import
// Unselected accounts are skipped; unmatched selected accounts are auto-created.

async function handlePDFImport(req, res) {
    const warnings = [];

    let selectedNumbers = null;
    if (req.body?.selectedAccountNumbers) {
        try { selectedNumbers = new Set(JSON.parse(req.body.selectedAccountNumbers)); }
        catch { return res.status(400).json({ error: 'selectedAccountNumbers must be a JSON array of account number strings.' }); }
    }

    let pdfResult;
    try {
        pdfResult = await parseFidelityPDF(req.file.buffer);
    } catch (err) {
        return res.status(err.status || 422).json({ error: err.message });
    }
    warnings.push(...pdfResult.warnings);

    if (!pdfResult.statementDate) {
        return res.status(422).json({
            error: 'Could not determine statement date from PDF.',
            warnings,
        });
    }

    // Filter to selected accounts (all non-zero accounts if no selection given)
    const accounts = selectedNumbers
        ? pdfResult.accounts.filter((a) => selectedNumbers.has(a.accountNumber))
        : pdfResult.accounts;

    if (!accounts.length) {
        return res.json({
            snapshotsCreated: 0, accountsMatched: 0, accountsCreated: 0,
            statementDate: pdfResult.statementDate, totalValue: 0, warnings,
        });
    }

    // Load user's existing accounts
    const acctResult = await query(
        `SELECT id, name, include_in_tracking, fidelity_account_number
         FROM accounts WHERE user_id = $1`,
        [req.user.id]
    );
    const matchAccount = buildMatcher(acctResult.rows);

    let accountsMatched = 0;
    let accountsCreated = 0;
    const balancePairs  = []; // [{ accountId, balance }]

    for (const pdfAcct of accounts) {
        const byNumber = pdfAcct.accountNumber
            ? acctResult.rows.find((a) => a.fidelity_account_number === pdfAcct.accountNumber)
            : null;
        let acct = byNumber || matchAccount(pdfAcct.accountName);

        if (!acct) {
            // Auto-create the account
            const shortName = deriveAccountName(pdfAcct.accountName);
            const created   = await query(
                `INSERT INTO accounts (user_id, name, type, balance, source, fidelity_account_number)
                 VALUES ($1, $2, $3, $4, 'manual', $5)
                 RETURNING id, name, fidelity_account_number`,
                [req.user.id, shortName, pdfAcct.accountType, pdfAcct.endingBalance, pdfAcct.accountNumber]
            );
            acct = created.rows[0];
            // Reflect the new account in subsequent iterations
            acctResult.rows.push(acct);
            accountsCreated++;
        } else {
            // Back-fill fidelity_account_number if not already set
            if (pdfAcct.accountNumber && !acct.fidelity_account_number) {
                await query(
                    `UPDATE accounts SET fidelity_account_number = $1 WHERE id = $2`,
                    [pdfAcct.accountNumber, acct.id]
                ).catch(() => {});
                acct.fidelity_account_number = pdfAcct.accountNumber;
            }
            accountsMatched++;
        }

        balancePairs.push({ accountId: acct.id, balance: pdfAcct.endingBalance });
    }

    // Snapshot total = sum of imported accounts' ending balances
    const snapshotTotal = balancePairs.reduce((s, p) => s + p.balance, 0);

    // Upsert the snapshot for this statement date
    // ON CONFLICT: update total so re-importing the same PDF is idempotent
    const snapResult = await query(
        `INSERT INTO snapshots (user_id, total, note, snapped_at)
         VALUES ($1, $2, 'PDF import', $3)
         ON CONFLICT (user_id, snapped_at) DO UPDATE
             SET total = EXCLUDED.total, note = EXCLUDED.note
         RETURNING id`,
        [req.user.id, snapshotTotal, pdfResult.statementDate]
    );
    const snapshotId = snapResult.rows[0].id;

    // Replace per-account snapshot rows for this snapshot
    await query(`DELETE FROM account_snapshots WHERE snapshot_id = $1`, [snapshotId]);
    for (const pair of balancePairs) {
        await query(
            `INSERT INTO account_snapshots (snapshot_id, account_id, balance) VALUES ($1, $2, $3)`,
            [snapshotId, pair.accountId, pair.balance]
        );
    }

    // Log to csv_import_log (reuses the same table; format = 'fidelity_pdf')
    await query(
        `INSERT INTO csv_import_log
           (user_id, filename, format, transactions_imported, snapshots_created,
            accounts_matched, accounts_unmatched, date_earliest, date_latest, warnings)
         VALUES ($1, $2, 'fidelity_pdf', 0, 1, $3, $4, $5, $5, $6)`,
        [
            req.user.id, req.file.originalname,
            accountsMatched, accountsCreated,
            pdfResult.statementDate, JSON.stringify(warnings),
        ]
    );

    return res.json({
        snapshotsCreated: 1,
        accountsMatched,
        accountsCreated,
        statementDate: pdfResult.statementDate,
        totalValue:    snapshotTotal,
        warnings,
    });
}

// ─── Manual balance history import ───────────────────────────────────────────

/**
 * Converts a date string (YYYY-MM or YYYY-MM-DD) to the last day of that month
 * as an ISO date string (YYYY-MM-DD).
 */
function toLastDayOfMonth(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).trim();

    let year, month;
    const ymMatch  = s.match(/^(\d{4})-(\d{2})$/);         // 2024-01
    const ymdMatch = s.match(/^(\d{4})-(\d{2})-\d{2}$/);  // 2024-01-31

    if (ymMatch) {
        year  = parseInt(ymMatch[1], 10);
        month = parseInt(ymMatch[2], 10);
    } else if (ymdMatch) {
        year  = parseInt(ymdMatch[1], 10);
        month = parseInt(ymdMatch[2], 10);
    } else {
        return null;
    }

    if (month < 1 || month > 12) return null;

    // Day 0 of the following JS month index = last day of this calendar month
    const d  = new Date(year, month, 0);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

/**
 * GET /import/manual-history/dates?accountId=<uuid>
 * Returns the snapshot dates that already have balance data for this account.
 * Used by the frontend to mark rows as "New" vs "Update" in the preview step.
 */
router.get('/manual-history/dates', requireAuth, async (req, res) => {
    try {
        const { accountId } = req.query;
        if (!accountId) return res.status(400).json({ error: 'accountId is required' });

        // Verify ownership
        const acct = await query(
            'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
            [accountId, req.user.id]
        );
        if (!acct.rows.length) return res.status(404).json({ error: 'Account not found' });

        const result = await query(
            `SELECT s.snapped_at
             FROM account_snapshots asn
             JOIN snapshots s ON s.id = asn.snapshot_id
             WHERE asn.account_id = $1 AND s.user_id = $2
             ORDER BY s.snapped_at`,
            [accountId, req.user.id]
        );

        return res.json({ dates: result.rows.map((r) => String(r.snapped_at).slice(0, 10)) });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to fetch dates' });
    }
});

/**
 * POST /import/manual-history
 * Imports monthly balance history for a manual account.
 * Body: { accountId, rows: [{ date: "2024-01" | "2024-01-31", value: 12500 }, ...] }
 * Each row upserts a snapshot and recalculates the day's total.
 */
router.post('/manual-history', requireAuth, async (req, res) => {
    try {
        const { accountId, rows } = req.body || {};

        if (!accountId) return res.status(400).json({ error: 'accountId is required' });
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'rows must be a non-empty array' });
        }

        // Verify account ownership
        const acctResult = await query(
            `SELECT id, name, display_name FROM accounts WHERE id = $1 AND user_id = $2`,
            [accountId, req.user.id]
        );
        if (!acctResult.rows.length) return res.status(404).json({ error: 'Account not found' });
        const acct = acctResult.rows[0];

        let rowsImported = 0;
        const importedDates = [];

        for (const row of rows) {
            const isoDate = toLastDayOfMonth(row.date);
            if (!isoDate) continue;

            const balance = Number(row.value);
            if (!Number.isFinite(balance)) continue;

            // 1. Upsert snapshot for this date (no-op if it already exists)
            const snapRes = await query(
                `INSERT INTO snapshots (user_id, total, snapped_at)
                 VALUES ($1, 0, $2)
                 ON CONFLICT (user_id, snapped_at)
                 DO UPDATE SET snapped_at = EXCLUDED.snapped_at
                 RETURNING id`,
                [req.user.id, isoDate]
            );
            const snapshotId = snapRes.rows[0].id;

            // 2. Delete any existing account_snapshot row for this account+date
            await query(
                'DELETE FROM account_snapshots WHERE snapshot_id = $1 AND account_id = $2',
                [snapshotId, accountId]
            );

            // 3. Insert the new balance
            await query(
                'INSERT INTO account_snapshots (snapshot_id, account_id, balance) VALUES ($1, $2, $3)',
                [snapshotId, accountId, balance]
            );

            // 4. Recalculate the snapshot total from all current account_snapshot rows
            await query(
                `UPDATE snapshots
                 SET total = (
                     SELECT COALESCE(SUM(asn.balance), 0)
                     FROM account_snapshots asn
                     WHERE asn.snapshot_id = $1
                 )
                 WHERE id = $1`,
                [snapshotId]
            );

            importedDates.push(isoDate);
            rowsImported++;
        }

        importedDates.sort();

        // Compute some stats for the result card
        const balanceMap = {};
        rows.forEach((r) => {
            const d = toLastDayOfMonth(r.date);
            if (d) balanceMap[d] = Number(r.value) || 0;
        });
        const values = importedDates.map((d) => balanceMap[d]).filter(Number.isFinite);
        const peakBalance = values.length ? Math.max(...values) : null;
        const peakDate    = peakBalance !== null
            ? importedDates[values.indexOf(peakBalance)]
            : null;
        const finalBalance = values.length ? values[values.length - 1] : null;

        return res.json({
            rowsImported,
            dateRange: {
                earliest: importedDates[0] || null,
                latest:   importedDates[importedDates.length - 1] || null,
            },
            accountName:   acct.display_name || acct.name,
            peakBalance,
            peakDate,
            finalBalance,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Import failed' });
    }
});

export default router;
