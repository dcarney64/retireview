// CSV import parser — currently supports Fidelity account-history exports.
// Parsers for other brokers can be added here; detectFormat() is the
// dispatch point. All parsers return the same normalized shape so the
// import route doesn't need to know which format was used.

import { createHash } from 'node:crypto';

// ─── Generic CSV tokenizer ────────────────────────────────────────────────────
// Handles RFC 4180: quoted fields, embedded commas, doubled-quote escapes.

function tokenizeLine(line) {
    const fields = [];
    let field     = '';
    let inQuotes  = false;
    let i         = 0;

    while (i < line.length) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { // escaped quote → single "
                field += '"';
                i += 2;
            } else if (ch === '"') {
                inQuotes = false;
                i++;
            } else {
                field += ch;
                i++;
            }
        } else if (ch === '"') {
            inQuotes = true;
            i++;
        } else if (ch === ',') {
            fields.push(field.trim());
            field = '';
            i++;
        } else {
            field += ch;
            i++;
        }
    }
    fields.push(field.trim());
    return fields;
}

// ─── Field value helpers ──────────────────────────────────────────────────────

/** Strip $, commas, and whitespace; return a finite number or null. */
function parseAmount(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    const n = parseFloat(String(raw).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
}

/**
 * Accepts MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD.
 * Returns ISO date string 'YYYY-MM-DD' or null.
 */
function parseDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    // MM/DD/YYYY or M/D/YYYY
    const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
        const [, mm, dd, yyyy] = slash;
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    // Already ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return null;
}

/** Deterministic external_id for idempotent re-imports. */
function makeExternalId(...parts) {
    const raw = parts.map((p) => String(p ?? '')).join('|');
    return 'csv:' + createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

// ─── Fidelity parser ──────────────────────────────────────────────────────────
//
// Expected header (single line found anywhere in the file):
//   "Run Date","Action","Symbol","Security Description","Security Type",
//   "Quantity","Price ($)","Commission ($)","Fees ($)","Accrued Interest ($)",
//   "Amount ($)","Settlement Date","Account Number","Account Name"

const FIDELITY_ACTION_MAP = {
    'YOU BOUGHT':                           'BUY',
    'YOU BOUGHT (MARGIN)':                  'BUY',
    'YOU SOLD':                             'SELL',
    'YOU SOLD (MARGIN)':                    'SELL',
    'SHORT SALE':                           'SELL',
    'DIVIDEND RECEIVED':                    'DIVIDEND',
    'CONTRIBUTION':                         'CONTRIBUTION',
    'WITHDRAWAL':                           'WITHDRAWAL',
    'DIRECT DEBIT':                         'WITHDRAWAL',
    'REINVESTMENT':                         'REINVEST',
    'INTEREST EARNED':                      'INTEREST',
    'INTEREST RECEIVED':                    'INTEREST',
    'TRANSFERRED IN (ACAT)':               'EXTERNAL_ASSET_TRANSFER_IN',
    'TRANSFERRED OUT (ACAT)':              'EXTERNAL_ASSET_TRANSFER_OUT',
    'TRANSFERRED IN':                       'EXTERNAL_ASSET_TRANSFER_IN',
    'TRANSFERRED OUT':                      'EXTERNAL_ASSET_TRANSFER_OUT',
    'IN-KIND TRANSFER':                     'EXTERNAL_ASSET_TRANSFER_IN',
    'ELECTRONIC FUNDS TRANSFER RECEIVED':  'CONTRIBUTION',
    'ELECTRONIC FUNDS TRANSFER DISBURSED': 'WITHDRAWAL',
    'CAPITAL GAINS DISTRIBUTIONS':         'DIVIDEND',
    'CASH DISBURSEMENT':                   'WITHDRAWAL',
    'RETURN OF PRINCIPAL':                 'WITHDRAWAL',
};

function mapFidelityAction(raw) {
    if (!raw) return 'OTHER';
    const upper = String(raw).toUpperCase().trim();
    if (FIDELITY_ACTION_MAP[upper]) return FIDELITY_ACTION_MAP[upper];
    // Prefix-match for variations like "YOU BOUGHT — MARGIN" etc.
    for (const [key, type] of Object.entries(FIDELITY_ACTION_MAP)) {
        if (upper.startsWith(key)) return type;
    }
    return 'OTHER';
}

/**
 * Parse Fidelity account history CSV text.
 * Returns { rows: NormalisedRow[], warnings: string[] }
 */
export function parseFidelityCSV(text) {
    const warnings = [];
    const rows     = [];

    // Normalise line endings and strip BOM.
    const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines  = clean.split('\n');

    // Find the data header line.
    let headerIdx    = -1;
    let headerFields = null;

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.includes('Run Date') && l.includes('Action') && l.includes('Amount ($)')) {
            headerIdx    = i;
            headerFields = tokenizeLine(l);
            break;
        }
    }

    if (headerIdx === -1) {
        return { rows: [], warnings: ['Could not find the Fidelity data header row in this CSV.'] };
    }

    // Build column index.
    const col = {};
    headerFields.forEach((f, i) => { col[f] = i; });

    const required = ['Run Date', 'Action', 'Amount ($)', 'Account Name'];
    for (const f of required) {
        if (col[f] === undefined) {
            warnings.push(`Missing required column: "${f}"`);
        }
    }
    if (warnings.length) return { rows: [], warnings };

    // Parse data rows.
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Skip Fidelity footer/metadata lines that aren't data.
        if (line.startsWith('Date range') || line.startsWith('Account Number,') || line.startsWith('Total')) continue;

        const f = tokenizeLine(line);
        if (f.length < required.length) continue;

        const runDate       = f[col['Run Date']]             || '';
        const action        = f[col['Action']]               || '';
        const symbol        = f[col['Symbol']]               || null;
        const description   = f[col['Security Description']] || null;
        const quantity      = f[col['Quantity']]             || '';
        const priceRaw      = f[col['Price ($)']]            || '';
        const amountRaw     = f[col['Amount ($)']]           || '';
        const accountName   = f[col['Account Name']]         || '';
        const accountNumber = col['Account Number'] !== undefined
            ? (f[col['Account Number']] || null)
            : null;

        if (!action.trim() || !accountName.trim()) continue;

        const transacted_at    = parseDate(runDate);
        if (!transacted_at) {
            warnings.push(`Row ${i + 1}: skipped — unrecognised date "${runDate}"`);
            continue;
        }

        const transaction_type = mapFidelityAction(action);
        const amount           = parseAmount(amountRaw);
        const units            = parseAmount(quantity);
        const price            = parseAmount(priceRaw);
        const external_id      = makeExternalId(accountName, transacted_at, action, symbol, amount);

        rows.push({
            transacted_at,
            transaction_type,
            symbol:        symbol || null,
            units,
            price,
            amount,
            accountName:   accountName.trim(),
            accountNumber: accountNumber?.trim() || null,
            description:   (description || action).trim().slice(0, 500),
            external_id,
        });
    }

    if (!rows.length) {
        warnings.push('Header was found but no data rows could be parsed — check that the file contains transaction history.');
    }

    return { rows, warnings };
}

// ─── Format detection ─────────────────────────────────────────────────────────

/** Returns 'fidelity' or null. */
export function detectFormat(text) {
    const sample = text.replace(/^﻿/, '').slice(0, 4000);
    if (sample.includes('Run Date') && sample.includes('Action') && sample.includes('Amount ($)')) {
        return 'fidelity';
    }
    return null;
}

/** Return the first N data rows for a client-side preview (after header). */
export function previewRows(text, n = 5) {
    const format = detectFormat(text);
    if (format === 'fidelity') {
        const { rows } = parseFidelityCSV(text);
        return { format, rows: rows.slice(0, n) };
    }
    return { format: null, rows: [] };
}

/**
 * Group parsed rows by (accountName, accountNumber) for the import review screen.
 * Returns an array of account summaries, sorted by accountName.
 */
export function groupByAccount(rows) {
    const map = new Map(); // key = accountName (lowercased) → group object

    for (const row of rows) {
        const key = row.accountName.toLowerCase();
        if (!map.has(key)) {
            map.set(key, {
                csvAccountName:   row.accountName,
                csvAccountNumber: row.accountNumber || null,
                transactionCount: 0,
                earliest:         row.transacted_at,
                latest:           row.transacted_at,
            });
        }
        const g = map.get(key);
        g.transactionCount++;
        if (row.transacted_at < g.earliest) g.earliest = row.transacted_at;
        if (row.transacted_at > g.latest)   g.latest   = row.transacted_at;
        // Keep the first non-null account number we see
        if (!g.csvAccountNumber && row.accountNumber) {
            g.csvAccountNumber = row.accountNumber;
        }
    }

    return [...map.values()].sort((a, b) => a.csvAccountName.localeCompare(b.csvAccountName));
}
