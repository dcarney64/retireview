// Reconstructs end-of-month portfolio snapshots from the account_transactions
// table. SnapTrade transaction history goes back much further than the app's
// snapshot history, so this gives the Performance page meaningful data
// immediately after the first brokerage connection.
//
// APPROACH — external cash-flow reconstruction:
//   Running per-account balance starts at 0. We walk transactions chronologically
//   and apply only EXTERNAL cash flows (deposits, withdrawals, dividends, interest)
//   so the running total represents "net money that has entered the portfolio".
//   BUY/SELL are intentionally excluded: they convert cash↔securities within the
//   account and cancel each other without mark-to-market data, producing near-zero
//   running balances that would be misleading on the Performance chart.
//
//   Reconstructed snapshots are tagged note='reconstructed from transaction history'
//   and use DO NOTHING on conflict, so they never overwrite real snapshots.

import pool from '../db/client.js';

// Transaction types that represent real money entering or leaving the portfolio,
// and the sign convention (positive = money in, negative = money out).
// Types not listed here (BUY, SELL, etc.) are skipped.
const TYPE_SIGN = {
    CONTRIBUTION:                +1,
    DEPOSIT:                     +1,
    DIVIDEND:                    +1,
    DIVIDENDS:                   +1,
    INTEREST:                    +1,
    REINVEST:                    +1,    // dividend reinvestment — income, even if reinvested
    EXTERNAL_ASSET_TRANSFER_IN:  +1,
    WITHDRAWAL:                  -1,
    EXTERNAL_ASSET_TRANSFER_OUT: -1,
    EXPENSE:                     -1,
    FEE:                         -1,
};

/** Signed amount for a transaction, normalised to the sign convention above. */
function signedAmount(txType, rawAmount) {
    const sign = TYPE_SIGN[txType];
    if (sign === undefined) return 0; // skip BUY, SELL, UNKNOWN, etc.
    return sign * Math.abs(Number(rawAmount) || 0);
}

/** Returns ISO 'YYYY-MM-DD' strings for every month-end between startStr and endStr (inclusive). */
function monthEndsBetween(startStr, endStr) {
    const result = [];
    const limit  = new Date(endStr + 'T00:00:00');
    const cursor = new Date(startStr + 'T00:00:00');
    // Advance to end of cursor's month.
    let year  = cursor.getFullYear();
    let month = cursor.getMonth(); // 0-indexed

    for (;;) {
        // Last calendar day of (year, month): day 0 of the NEXT month.
        const monthEnd = new Date(year, month + 1, 0);
        if (monthEnd > limit) break;
        result.push(monthEnd.toISOString().slice(0, 10));
        month += 1;
        if (month > 11) { month = 0; year += 1; }
    }
    return result;
}

/**
 * Reconstruct end-of-month snapshots for userId from transaction history.
 *
 * Idempotent — safe to call multiple times. Existing snapshots are never
 * overwritten (ON CONFLICT DO NOTHING).
 *
 * Returns { monthsReconstructed, earliestDate, latestDate }.
 */
export async function reconstructHistoryForUser(userId) {
    const client = await pool.connect();
    try {
        // ── 1. Fetch all relevant transactions ──────────────────────────────────
        const txResult = await client.query(
            `SELECT
               account_id,
               transaction_type,
               amount::numeric AS amount,
               transacted_at::text AS date
             FROM account_transactions
             WHERE user_id       = $1
               AND amount        IS NOT NULL
               AND amount        != 0
               AND transaction_type = ANY($2)
             ORDER BY transacted_at ASC, created_at ASC`,
            [userId, Object.keys(TYPE_SIGN)]
        );

        const transactions = txResult.rows;
        if (!transactions.length) {
            return { monthsReconstructed: 0, earliestDate: null, latestDate: null };
        }

        // ── 2. Look up existing snapshot dates (O(1) skip) ─────────────────────
        const existingResult = await client.query(
            `SELECT snapped_at::text AS date FROM snapshots WHERE user_id = $1`,
            [userId]
        );
        const existingDates = new Set(existingResult.rows.map((r) => r.date));

        // ── 3. Valid account IDs — only include_in_tracking=true accounts ──────
        const accountsResult = await client.query(
            `SELECT id FROM accounts WHERE user_id = $1 AND include_in_tracking = true`,
            [userId]
        );
        const validAccountIds = new Set(accountsResult.rows.map((r) => r.id));

        // ── 4. Date range: earliest tx → end of last complete month ─────────────
        const earliestDate = transactions[0].date;
        const prevMonthEnd = (() => {
            const d = new Date();
            d.setDate(0); // day 0 of current month = last day of previous month
            return d.toISOString().slice(0, 10);
        })();

        if (earliestDate > prevMonthEnd) {
            return { monthsReconstructed: 0, earliestDate: null, latestDate: null };
        }

        const monthEnds = monthEndsBetween(earliestDate, prevMonthEnd);

        // ── 5. Single-pass walk: apply transactions, snapshot at each month-end ─
        const runningBalances = {}; // accountId → numeric running total
        let txIndex            = 0;
        let monthsReconstructed = 0;
        let latestDate          = null;

        for (const monthEnd of monthEnds) {
            // Advance txIndex past all transactions whose date ≤ monthEnd.
            while (txIndex < transactions.length && transactions[txIndex].date <= monthEnd) {
                const tx = transactions[txIndex];
                if (validAccountIds.has(tx.account_id)) {
                    const delta = signedAmount(tx.transaction_type, tx.amount);
                    if (delta !== 0) {
                        runningBalances[tx.account_id] = (runningBalances[tx.account_id] || 0) + delta;
                    }
                }
                txIndex++;
            }

            // Skip dates that already have a snapshot.
            if (existingDates.has(monthEnd)) continue;

            // Only keep accounts with a positive balance at this point.
            const positiveEntries = Object.entries(runningBalances).filter(([, v]) => v > 0);
            if (!positiveEntries.length) continue;

            const total = positiveEntries.reduce((sum, [, v]) => sum + v, 0);

            // Insert snapshot + per-account rows in a mini-transaction.
            try {
                await client.query('BEGIN');

                const snapResult = await client.query(
                    `INSERT INTO snapshots (user_id, total, note, snapped_at)
                     VALUES ($1, $2, 'reconstructed from transaction history', $3)
                     ON CONFLICT (user_id, snapped_at) DO NOTHING
                     RETURNING id`,
                    [userId, total, monthEnd]
                );

                if (snapResult.rowCount > 0) {
                    const snapId = snapResult.rows[0].id;
                    for (const [accountId, balance] of positiveEntries) {
                        await client.query(
                            `INSERT INTO account_snapshots (snapshot_id, account_id, balance)
                             VALUES ($1, $2, $3)`,
                            [snapId, accountId, balance]
                        );
                    }
                    monthsReconstructed++;
                    latestDate = monthEnd;
                }

                await client.query('COMMIT');
            } catch (insertErr) {
                await client.query('ROLLBACK').catch(() => {});
                console.error(`[reconstruct] Skipped ${monthEnd}:`, insertErr.message);
            }
        }

        return {
            monthsReconstructed,
            earliestDate: monthsReconstructed > 0 ? earliestDate : null,
            latestDate,
        };
    } finally {
        client.release();
    }
}
