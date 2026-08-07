import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';
import { backfillPortfolioHistory } from '../services/composerService.js';
import { reconstructHistoryForUser } from '../services/historyReconstructService.js';

const router = Router();

// ─── In-memory benchmark cache (24 h TTL) ────────────────────────────────────
const benchmarkCache = new Map();
const BENCH_TTL_MS = 86_400_000;
const SUPPORTED_TICKERS = new Set(['SPY', 'QQQ', 'BND', 'GLD']);

// ─── Window definitions ───────────────────────────────────────────────────────
const WINDOWS = {
    '1m':  { days: 30,  ytd: false },
    '3m':  { days: 90,  ytd: false },
    '6m':  { days: 180, ytd: false },
    ytd:   { days: null, ytd: true  },
    '1y':  { days: 365, ytd: false },
    all:   { days: null, ytd: false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getWindowCutoff(windowId) {
    const { days, ytd } = WINDOWS[windowId] || { days: null, ytd: false };
    const now = new Date();
    if (ytd) return new Date(now.getFullYear(), 0, 1);
    if (days) {
        const d = new Date(now);
        d.setDate(d.getDate() - days);
        return d;
    }
    return null;
}

/**
 * Modified Dietz TWR chain-linked across snapshot intervals.
 *
 * snapshots: [{ date: 'YYYY-MM-DD', total: number }] sorted ASC
 * transfers: [{ transferred_at: 'YYYY-MM-DD', amount: number }]
 *
 * For each sub-period [snapshot_i, snapshot_i+1]:
 *   R_i = (V_end − V_start − ΣCF) / (V_start + Σ(W_t × CF_t))
 *   where W_t = (D − d_t) / D  (time-weight of each flow)
 * TWR = Π(1 + R_i) − 1
 */
function computeTWR(snapshots, transfers) {
    if (snapshots.length < 2) return null;

    let product = 1;

    for (let i = 0; i < snapshots.length - 1; i++) {
        const startDate = new Date(snapshots[i].date + 'T00:00:00');
        const endDate   = new Date(snapshots[i + 1].date + 'T00:00:00');
        const D = (endDate - startDate) / 86_400_000; // days in sub-period
        const Vs = toNum(snapshots[i].total);
        const Ve = toNum(snapshots[i + 1].total);

        // Collect transfers that fall inside this sub-period (exclusive start, inclusive end).
        const flows = transfers.filter((t) => {
            const td = new Date(t.transferred_at + 'T00:00:00');
            return td > startDate && td <= endDate;
        });

        let netCF = 0;
        let weightedCF = 0;
        for (const t of flows) {
            const td = new Date(t.transferred_at + 'T00:00:00');
            const d = (td - startDate) / 86_400_000;
            const W = D > 0 ? (D - d) / D : 0.5;
            const cf = toNum(t.amount);
            netCF += cf;
            weightedCF += W * cf;
        }

        const denom = Vs + weightedCF;
        if (denom <= 0 || !Number.isFinite(denom)) continue;

        const R = (Ve - Vs - netCF) / denom;
        if (!Number.isFinite(R)) continue;

        product *= (1 + R);
    }

    return product - 1;
}

/**
 * Running max drawdown across a sorted series [{date, total}].
 * Returns { series, maxDrawdown, peakDate, troughDate }.
 */
function computeDrawdown(series) {
    if (!series.length) {
        return { series: [], maxDrawdown: 0, peakDate: null, troughDate: null };
    }

    let peak = toNum(series[0].total);
    let peakDate = series[0].date;
    let maxDrawdown = 0;
    let troughDate = series[0].date;

    const out = series.map((p) => {
        const v = toNum(p.total);
        if (v > peak) {
            peak = v;
            peakDate = p.date;
        }
        const dd = peak > 0 ? (v - peak) / peak : 0;
        if (dd < maxDrawdown) {
            maxDrawdown = dd;
            troughDate = p.date;
        }
        return { date: p.date, total: v, drawdown_decimal: dd, peak };
    });

    return { series: out, maxDrawdown, peakDate, troughDate };
}

/**
 * Month-over-month returns using the last snapshot in each calendar month,
 * with Modified Dietz for any transfers in the period.
 */
function computeMonthlyReturns(series, transfers) {
    if (series.length < 2) return [];

    // Group snapshots by YYYY-MM; keep only the last (latest) per month.
    const byMonth = new Map();
    for (const p of series) {
        const key = p.date.slice(0, 7);
        byMonth.set(key, p); // later snapshots overwrite earlier ones
    }

    const keys = [...byMonth.keys()].sort();
    const results = [];

    for (let i = 1; i < keys.length; i++) {
        const prev = byMonth.get(keys[i - 1]);
        const curr = byMonth.get(keys[i]);
        const [year, month] = keys[i].split('-').map(Number);

        const Vs = toNum(prev.total);
        const Ve = toNum(curr.total);
        const startDate = new Date(prev.date + 'T00:00:00');
        const endDate   = new Date(curr.date + 'T00:00:00');
        const D = (endDate - startDate) / 86_400_000;

        const flows = transfers.filter((t) => {
            const td = new Date(t.transferred_at + 'T00:00:00');
            return td > startDate && td <= endDate;
        });

        let netCF = 0;
        let weightedCF = 0;
        for (const t of flows) {
            const td = new Date(t.transferred_at + 'T00:00:00');
            const d = (td - startDate) / 86_400_000;
            const W = D > 0 ? (D - d) / D : 0.5;
            const cf = toNum(t.amount);
            netCF += cf;
            weightedCF += W * cf;
        }

        const denom = Vs + weightedCF;
        if (denom <= 0 || !Number.isFinite(denom)) continue;

        const ret = (Ve - Vs - netCF) / denom;
        if (!Number.isFinite(ret)) continue;

        results.push({ year, month, return_decimal: ret, value_start: Vs, value_end: Ve });
    }

    return results;
}

/**
 * Pre-compute { simpleReturn, twr, snapshotCount, startValue, endValue }
 * for each standard time window.
 */
function computeWindowStats(allSeries, allTransfers) {
    const stats = {};

    for (const windowId of Object.keys(WINDOWS)) {
        const cutoff = getWindowCutoff(windowId);

        const wSeries = cutoff
            ? allSeries.filter((p) => new Date(p.date + 'T00:00:00') >= cutoff)
            : allSeries;

        const wTransfers = cutoff
            ? allTransfers.filter((t) => new Date(t.transferred_at + 'T00:00:00') >= cutoff)
            : allTransfers;

        if (!wSeries.length) {
            stats[windowId] = { simpleReturn: null, twr: null, snapshotCount: 0, startValue: null, endValue: null };
            continue;
        }

        const startValue = toNum(wSeries[0].total);
        const endValue   = toNum(wSeries[wSeries.length - 1].total);
        const simpleReturn = startValue > 0 ? (endValue - startValue) / startValue : null;
        const twr = computeTWR(wSeries, wTransfers);

        stats[windowId] = { simpleReturn, twr, snapshotCount: wSeries.length, startValue, endValue };
    }

    return stats;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/performance
 *
 * Returns everything the Performance page needs in a single call:
 *   series            – [{date, total}] merged daily series (Composer ph + forward-filled others)
 *   accountTypeSeries – [{date, brokerage, retirement, ...}] per-type stacked (snapshot-based)
 *   types             – ordered list of type keys present in the data
 *   accountSeries     – [{accountId, accountName, accountType, data:[{date,value}]}] per account
 *   monthlyReturns    – [{year, month, return_decimal, value_start, value_end}]
 *   drawdown          – { series, maxDrawdown, peakDate, troughDate }
 *   transfers         – [{date, amount, transfer_type, account_name}]
 *   windowStats       – pre-computed { simpleReturn, twr, snapshotCount } per window
 *   bestMonth         – monthly return row with the highest return_decimal
 *   worstMonth        – monthly return row with the lowest return_decimal
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        const [snapshotsResult, transfersResult, composerHistResult, nonComposerSnapsResult] =
            await Promise.all([
                // ── Aggregate snapshots (for accountTypeSeries + fallback series) ──
                query(
                    `SELECT s.snapped_at::text AS date,
                            s.total,
                            COALESCE(
                                json_agg(
                                    json_build_object('type', a.type, 'balance', asn.balance)
                                    ORDER BY a.type
                                ) FILTER (WHERE asn.id IS NOT NULL),
                                '[]'
                            ) AS accounts
                     FROM snapshots s
                     LEFT JOIN account_snapshots asn ON asn.snapshot_id = s.id
                     LEFT JOIN accounts a            ON a.id = asn.account_id
                     WHERE s.user_id = $1
                     GROUP BY s.id, s.snapped_at, s.total
                     ORDER BY s.snapped_at ASC`,
                    [userId]
                ),
                // ── Transfers for TWR ──────────────────────────────────────────────
                query(
                    `SELECT t.id,
                            t.account_id,
                            t.amount,
                            t.transfer_type,
                            t.transferred_at::text AS transferred_at,
                            t.notes,
                            a.name AS account_name,
                            a.type AS account_type
                     FROM account_transfers t
                     JOIN accounts a ON a.id = t.account_id
                     WHERE t.user_id = $1
                     ORDER BY t.transferred_at ASC`,
                    [userId]
                ),
                // ── Composer daily NAV from portfolio_history ──────────────────────
                query(
                    `SELECT ph.history_date::text AS date,
                            ph.account_id::text   AS account_id,
                            a.name                AS account_name,
                            ph.portfolio_value::float AS value
                     FROM portfolio_history ph
                     JOIN accounts a ON a.id = ph.account_id
                     WHERE ph.user_id = $1
                       AND a.include_in_tracking = true
                     ORDER BY ph.history_date ASC, a.name ASC`,
                    [userId]
                ),
                // ── Non-Composer per-account snapshot balances ─────────────────────
                query(
                    `SELECT s.snapped_at::text   AS date,
                            asn.account_id::text AS account_id,
                            a.name               AS account_name,
                            a.type               AS account_type,
                            asn.balance::float   AS balance
                     FROM snapshots s
                     JOIN account_snapshots asn ON asn.snapshot_id = s.id
                     JOIN accounts a            ON a.id = asn.account_id
                     WHERE s.user_id = $1
                       AND a.source != 'composer'
                       AND a.include_in_tracking = true
                     ORDER BY s.snapped_at ASC, a.name ASC`,
                    [userId]
                ),
            ]);

        const snapshots           = snapshotsResult.rows;
        const transfers           = transfersResult.rows;
        const composerHistRows    = composerHistResult.rows;    // [{date, account_id, account_name, value}]
        const nonComposerSnapRows = nonComposerSnapsResult.rows; // [{date, account_id, account_name, account_type, balance}]

        // ── accountTypeSeries + types (from aggregate snapshots, unchanged) ───────

        const typeSet = new Set();
        for (const s of snapshots) {
            for (const a of (s.accounts || [])) typeSet.add(a.type);
        }
        const TYPE_ORDER = ['brokerage', 'composer', 'retirement', 'pension', 'real_estate', 'cash', 'other'];
        const types = TYPE_ORDER.filter((t) => typeSet.has(t));

        const accountTypeSeries = snapshots.map((s) => {
            const point = { date: s.date };
            const acctMap = {};
            for (const a of (s.accounts || [])) {
                acctMap[a.type] = (acctMap[a.type] || 0) + toNum(a.balance);
            }
            for (const type of types) {
                point[type] = acctMap[type] || 0;
            }
            return point;
        });

        // ── Main series: merged daily (portfolio_history) + forward-fill others ──
        //
        // Strategy:
        //   • If portfolio_history has data (post-backfill): build a daily series
        //     where Composer values come from portfolio_history and non-Composer values
        //     are forward-filled from their account_snapshots.
        //   • Otherwise: fall back to the existing snapshot-based series so the page
        //     works correctly even before a backfill has run.

        let series;

        if (composerHistRows.length > 0) {
            // Build date → summed Composer value map.
            const composerByDate = new Map();
            for (const row of composerHistRows) {
                composerByDate.set(row.date, (composerByDate.get(row.date) || 0) + toNum(row.value));
            }

            // Build per non-Composer account: sorted [{date, balance}] for forward-fill.
            const nonComposerAccts = new Map(); // account_id → { type, dates[] }
            for (const row of nonComposerSnapRows) {
                if (!nonComposerAccts.has(row.account_id)) {
                    nonComposerAccts.set(row.account_id, { type: row.account_type, dates: [] });
                }
                nonComposerAccts.get(row.account_id).dates.push({
                    date: row.date, balance: toNum(row.balance),
                });
            }
            // dates are already sorted ASC from the query.

            // Forward-fill helper: last known balance on or before targetDate.
            function forwardFill(sortedDates, targetDate) {
                let last = 0;
                for (const { date, balance } of sortedDates) {
                    if (date <= targetDate) last = balance;
                    else break;
                }
                return last;
            }

            // Union of all dates from both sources.
            const allDateSet = new Set(composerByDate.keys());
            for (const { dates } of nonComposerAccts.values()) {
                for (const { date } of dates) allDateSet.add(date);
            }
            const sortedDates = [...allDateSet].sort();

            // Build the merged series, forward-filling BOTH Composer and non-Composer
            // totals across dates that only appear in the other source.
            let lastComposerTotal = 0;
            series = sortedDates.map((date) => {
                // Update the running Composer total when this date has portfolio_history.
                if (composerByDate.has(date)) {
                    lastComposerTotal = composerByDate.get(date);
                }
                // Use the last known Composer total (forward-fill for non-ph dates).
                const composerTotal = lastComposerTotal;

                let nonComposerTotal = 0;
                for (const { dates } of nonComposerAccts.values()) {
                    nonComposerTotal += forwardFill(dates, date);
                }
                return { date, total: composerTotal + nonComposerTotal };
            });
        } else {
            // No portfolio_history yet → use aggregate snapshots as before.
            series = snapshots.map((s) => ({ date: s.date, total: toNum(s.total) }));
        }

        // ── Per-account series for the "By Account" chart ─────────────────────────

        // Composer accounts: from portfolio_history (daily).
        const composerAcctMap = new Map(); // account_id → { name, data[] }
        for (const row of composerHistRows) {
            if (!composerAcctMap.has(row.account_id)) {
                composerAcctMap.set(row.account_id, { name: row.account_name, data: [] });
            }
            composerAcctMap.get(row.account_id).data.push({ date: row.date, value: toNum(row.value) });
        }

        // Non-Composer accounts: from account_snapshots (sparse).
        const nonComposerAcctMap = new Map(); // account_id → { name, type, data[] }
        for (const row of nonComposerSnapRows) {
            if (!nonComposerAcctMap.has(row.account_id)) {
                nonComposerAcctMap.set(row.account_id, {
                    name: row.account_name, type: row.account_type, data: [],
                });
            }
            nonComposerAcctMap.get(row.account_id).data.push({ date: row.date, value: toNum(row.balance) });
        }

        const accountSeries = [
            ...Array.from(composerAcctMap.entries()).map(([accountId, acct]) => ({
                accountId,
                accountName: acct.name,
                accountType: 'composer',
                data:        acct.data,
            })),
            ...Array.from(nonComposerAcctMap.entries()).map(([accountId, acct]) => ({
                accountId,
                accountName: acct.name,
                accountType: acct.type,
                data:        acct.data,
            })),
        ];

        // ── Computed metrics ──────────────────────────────────────────────────────

        const drawdownResult = computeDrawdown(series);
        const monthlyReturns = computeMonthlyReturns(series, transfers);
        const windowStats    = computeWindowStats(series, transfers);

        let bestMonth  = null;
        let worstMonth = null;
        for (const m of monthlyReturns) {
            if (bestMonth  === null || m.return_decimal > bestMonth.return_decimal)  bestMonth  = m;
            if (worstMonth === null || m.return_decimal < worstMonth.return_decimal) worstMonth = m;
        }

        return res.json({
            series,
            accountTypeSeries,
            types,
            accountSeries,
            monthlyReturns,
            drawdown: {
                series:      drawdownResult.series,
                maxDrawdown: drawdownResult.maxDrawdown,
                peakDate:    drawdownResult.peakDate,
                troughDate:  drawdownResult.troughDate,
            },
            transfers: transfers.map((t) => ({
                date:          t.transferred_at,
                amount:        toNum(t.amount),
                transfer_type: t.transfer_type,
                account_name:  t.account_name,
                account_type:  t.account_type,
            })),
            windowStats,
            bestMonth,
            worstMonth,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load performance data' });
    }
});

/**
 * GET /api/performance/benchmark/:ticker
 *
 * Fetches 2 years of daily closing prices for the given ticker from Yahoo Finance
 * and caches the result in memory for 24 hours.
 * Supported: SPY, QQQ, BND, GLD
 */
router.get('/benchmark/:ticker', requireAuth, async (req, res) => {
    const upper = req.params.ticker.toUpperCase();
    if (!SUPPORTED_TICKERS.has(upper)) {
        return res.status(400).json({ error: `Unsupported ticker. Supported: ${[...SUPPORTED_TICKERS].join(', ')}` });
    }

    const cached = benchmarkCache.get(upper);
    if (cached && (Date.now() - cached.cachedAt) < BENCH_TTL_MS) {
        return res.json({ ticker: upper, series: cached.series });
    }

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${upper}?interval=1d&range=2y`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) {
            throw new Error(`Yahoo Finance responded with ${resp.status}`);
        }
        const json = await resp.json();
        const result = json?.chart?.result?.[0];
        const timestamps = result?.timestamp || [];
        const closes     = result?.indicators?.quote?.[0]?.close || [];

        const series = timestamps
            .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: closes[i] ?? null }))
            .filter((p) => p.close !== null);

        benchmarkCache.set(upper, { series, cachedAt: Date.now() });
        return res.json({ ticker: upper, series });
    } catch (err) {
        return res.status(502).json({ error: `Could not fetch benchmark data: ${err.message}` });
    }
});

/**
 * POST /api/performance/reconstruct-history
 *
 * Runs the history reconstruction for the authenticated user.
 * Safe to call multiple times — existing snapshots are never overwritten.
 * Returns { monthsReconstructed, earliestDate, latestDate }.
 */
router.post('/reconstruct-history', requireAuth, async (req, res) => {
    try {
        const result = await reconstructHistoryForUser(req.user.id);
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Reconstruction failed' });
    }
});

/**
 * POST /api/performance/backfill-composer
 *
 * Pulls complete daily NAV history from the Composer API for every Composer
 * account belonging to the authenticated user, then bulk-inserts the rows into
 * portfolio_history (ON CONFLICT DO UPDATE so it is safe to re-run).
 *
 * Returns {
 *   accountsProcessed, rowsInserted,
 *   accounts: [{ name, pointCount, earliest, latest }],
 *   dateRange: { earliest, latest }
 * }
 */
router.post('/backfill-composer', requireAuth, async (req, res) => {
    try {
        const result = await backfillPortfolioHistory(req.user.id);
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Composer backfill failed' });
    }
});

export default router;
