// Composer.trade API integration.
// Docs: https://api.composer.trade/docs/index.html
// Base URL: https://api.composer.trade
//
// Auth — two headers required on every request:
//   x-api-key-id:   <COMPOSER_API_KEY_ID>
//   authorization:  Bearer <COMPOSER_API_SECRET>
//
// Rate limit: 1 req/sec on most endpoints.
//
// /accounts/list returns account_uuid, account_type, account_number — no name or balance.
// Balance lives in /portfolio/accounts/{id}/total-stats → portfolio_value.
// We fetch stats sequentially to stay within the 1 req/sec rate limit.

import { query } from '../db/client.js';
import { decryptSecret } from '../lib/secretCrypto.js';
import { takeSnapshot } from './snapshotService.js';

const COMPOSER_API_BASE = process.env.COMPOSER_API_URL || 'https://api.composer.trade';

async function composerFetch(path, apiKeyId, apiSecret, method = 'GET', body) {
    const options = {
        method,
        headers: {
            'x-api-key-id': apiKeyId,
            authorization: `Bearer ${apiSecret}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    return fetch(`${COMPOSER_API_BASE}${path}`, options);
}

// Maps Composer account_type to a human-readable label.
function formatAccountName(accountType, accountNumber) {
    const typeLabel = {
        INDIVIDUAL:      'Individual Brokerage',
        TRADITIONAL_IRA: 'Traditional IRA',
        ROTH_IRA:        'Roth IRA',
        JOINT:           'Joint Account',
        CUSTODIAL:       'Custodial Account',
        SEP_IRA:         'SEP IRA',
        SIMPLE_IRA:      'SIMPLE IRA',
    }[accountType] ?? (accountType ? accountType.replace(/_/g, ' ') : 'Account');

    return accountNumber ? `${typeLabel} · ${accountNumber}` : typeLabel;
}

// ─── Connection test ──────────────────────────────────────────────────────────

// Fast auth check — only hits /accounts/list, does not fetch balances.
// Returns { success, error? }
export async function testConnection(apiKeyId, apiSecret) {
    try {
        const response = await composerFetch('/api/v0.1/accounts/list', apiKeyId, apiSecret);
        if (response.ok) {
            const data = await response.json();
            const raw = Array.isArray(data) ? data : (data.accounts ?? []);
            return { success: true, accountCount: raw.length };
        }
        const text = await response.text().catch(() => '');
        return { success: false, error: `HTTP ${response.status}${text ? ': ' + text : ''}` };
    } catch (error) {
        return { success: false, error: error.message || 'Network error' };
    }
}

// ─── Accounts list (with balances) ───────────────────────────────────────────

// GET /api/v0.1/accounts/list  +  GET /api/v0.1/portfolio/accounts/{id}/total-stats
//
// The list endpoint returns metadata only (no balance). We fetch total-stats
// for each account sequentially to stay within the 1 req/sec rate limit.
//
// Returns [{ id, name, value, currency, type, status }]
export async function fetchComposerAccounts(apiKeyId, apiSecret) {
    const listResp = await composerFetch('/api/v0.1/accounts/list', apiKeyId, apiSecret);
    if (!listResp.ok) {
        const text = await listResp.text().catch(() => '');
        throw new Error(`Composer API error ${listResp.status}${text ? ': ' + text : ''}`);
    }
    const listData = await listResp.json();
    const raw = Array.isArray(listData) ? listData : (listData.accounts ?? listData.data ?? []);

    const accounts = [];
    for (const a of raw) {
        const id   = String(a.account_uuid ?? a.id ?? '');
        const name = formatAccountName(a.account_type, a.account_number);

        let value = 0;
        try {
            const statsResp = await composerFetch(
                `/api/v0.1/portfolio/accounts/${id}/total-stats`,
                apiKeyId,
                apiSecret
            );
            if (statsResp.ok) {
                const stats = await statsResp.json();
                value = parseFloat(stats.portfolio_value ?? 0);
            } else {
                console.warn(`[composer] total-stats ${statsResp.status} for ${id}`);
            }
        } catch (err) {
            console.warn(`[composer] Could not fetch stats for ${id}:`, err.message);
        }

        accounts.push({
            id,
            name,
            value,
            currency: 'USD',
            type:     a.account_type ?? null,
            status:   a.status ?? null,
        });
    }

    return accounts;
}

// ─── Account holdings ─────────────────────────────────────────────────────────

// GET /api/v0.1/accounts/{account-id}/holdings?position_type=ALL
// position_type: DEFAULT_DIRECT | SYMPHONY | ALL
// Returns raw holdings object from Composer.
export async function fetchAccountHoldings(accountId, apiKeyId, apiSecret, positionType = 'ALL') {
    const qs = positionType ? `?position_type=${encodeURIComponent(positionType)}` : '';
    const response = await composerFetch(
        `/api/v0.1/accounts/${accountId}/holdings${qs}`,
        apiKeyId,
        apiSecret
    );
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Composer holdings error ${response.status}${text ? ': ' + text : ''}`);
    }
    return response.json();
}

// ─── Portfolio statistics & NAV history ──────────────────────────────────────

// GET /api/v0.1/portfolio/accounts/{account-id}/total-stats
// Returns portfolio value, returns, deposits, cash, performance metrics.
export async function fetchAccountStats(accountId, apiKeyId, apiSecret) {
    const response = await composerFetch(
        `/api/v0.1/portfolio/accounts/${accountId}/total-stats`,
        apiKeyId,
        apiSecret
    );
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Composer stats error ${response.status}${text ? ': ' + text : ''}`);
    }
    return response.json();
}

// GET /api/v0.1/portfolio/accounts/{account-id}/portfolio-history
// Returns time-series: [{ epoch_ms, portfolio_value, cumulative_return }]
export async function fetchPortfolioHistory(accountId, apiKeyId, apiSecret) {
    const response = await composerFetch(
        `/api/v0.1/portfolio/accounts/${accountId}/portfolio-history`,
        apiKeyId,
        apiSecret
    );
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Composer history error ${response.status}${text ? ': ' + text : ''}`);
    }
    return response.json();
}

// ─── Activity / transaction history ──────────────────────────────────────────

// GET /api/v0.1/reports/{account-id}
// Options: { since, until } — ISO 8601 strings
//          { reportType }   — 'trade-activity' | 'non-trade-activity'
// Returns raw activity data from Composer.
export async function fetchActivityReports(accountId, apiKeyId, apiSecret, options = {}) {
    const params = new URLSearchParams();
    if (options.since)      params.set('since', options.since);
    if (options.until)      params.set('until', options.until);
    if (options.reportType) params.set('report-type', options.reportType);

    const qs = params.toString() ? `?${params}` : '';
    const response = await composerFetch(
        `/api/v0.1/reports/${accountId}${qs}`,
        apiKeyId,
        apiSecret
    );
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Composer reports error ${response.status}${text ? ': ' + text : ''}`);
    }
    return response.json();
}

// ─── DB sync ──────────────────────────────────────────────────────────────────

// Syncs balances for all Composer accounts for a user.
// Reads credentials from composer_credentials; upserts into accounts using external_id.
// On INSERT: sets name from Composer (account type + number). On UPDATE: balance only.
// Also inserts today's portfolio value into portfolio_history for daily tracking.
// Returns { accountsUpdated }.
export async function syncComposerAccountsForUser(userId) {
    const credResult = await query(
        'SELECT key_id, key_secret_enc FROM composer_credentials WHERE user_id = $1',
        [userId]
    );

    if (credResult.rows.length === 0) {
        return { accountsUpdated: 0, skipped: true };
    }

    const { key_id, key_secret_enc } = credResult.rows[0];
    const keySecret = decryptSecret(key_secret_enc);
    const composerAccounts = await fetchComposerAccounts(key_id, keySecret);

    // Resolve the primary profile so we can stamp it on new account rows.
    const profileRes = await query(
        `SELECT id FROM profiles WHERE user_id = $1 AND is_primary = true LIMIT 1`,
        [userId]
    );
    const profileId = profileRes.rows[0]?.id;
    if (!profileId) throw new Error('No primary profile found for user');

    let accountsUpdated = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const ca of composerAccounts) {
        // Upsert account row and get back its DB id.
        const upsertResult = await query(
            `INSERT INTO accounts
               (user_id, profile_id, name, type, balance, source, external_id, institution, last_synced_at, updated_at)
             VALUES ($1, $2, $3, 'composer', $4, 'composer', $5, 'Composer', NOW(), NOW())
             ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL
             DO UPDATE SET
               balance        = EXCLUDED.balance,
               last_synced_at = NOW(),
               updated_at     = NOW()
             RETURNING id`,
            [userId, profileId, ca.name, ca.value, ca.id]
        );
        accountsUpdated++;

        // Keep portfolio_history current with today's value so the
        // Performance chart stays fresh without a manual backfill.
        const dbAccountId = upsertResult.rows[0]?.id;
        if (dbAccountId && ca.value > 0) {
            await query(
                `INSERT INTO portfolio_history
                   (user_id, account_id, history_date, portfolio_value, source)
                 VALUES ($1, $2, $3, $4, 'composer')
                 ON CONFLICT (account_id, history_date)
                 DO UPDATE SET portfolio_value = EXCLUDED.portfolio_value`,
                [userId, dbAccountId, today, ca.value]
            );
        }
    }

    await query(
        'UPDATE composer_credentials SET synced_at = NOW(), updated_at = NOW() WHERE user_id = $1',
        [userId]
    );

    // Auto-snapshot after every sync.
    try {
        await takeSnapshot(userId, 'auto: composer sync');
    } catch (snapErr) {
        console.error('[composer] Auto-snapshot failed:', snapErr.message);
    }

    return { accountsUpdated };
}

// ─── Historical NAV backfill ──────────────────────────────────────────────────

// Fetches complete daily portfolio history from Composer for every Composer
// account belonging to userId and bulk-inserts into portfolio_history.
//
// The Composer endpoint returns { epoch_ms: [...], series: [...] } where
// each element is a daily NAV value going back to account inception.
//
// Returns { accountsProcessed, rowsInserted, accounts, dateRange }.
export async function backfillPortfolioHistory(userId) {
    const credResult = await query(
        'SELECT key_id, key_secret_enc FROM composer_credentials WHERE user_id = $1',
        [userId]
    );

    if (credResult.rows.length === 0) {
        return { accountsProcessed: 0, rowsInserted: 0, skipped: true,
                 reason: 'No Composer credentials found' };
    }

    const { key_id, key_secret_enc } = credResult.rows[0];
    const keySecret = decryptSecret(key_secret_enc);

    // All Composer accounts for this user that have an external_id.
    const accountsResult = await query(
        `SELECT id, external_id, name
         FROM accounts
         WHERE user_id = $1 AND source = 'composer' AND external_id IS NOT NULL
         ORDER BY name`,
        [userId]
    );

    if (accountsResult.rows.length === 0) {
        return { accountsProcessed: 0, rowsInserted: 0, skipped: true,
                 reason: 'No Composer accounts found' };
    }

    let totalRowsInserted = 0;
    let globalEarliest    = null;
    let globalLatest      = null;
    const accountSummaries = [];

    for (const account of accountsResult.rows) {
        try {
            console.log(`[composer] Fetching portfolio history for ${account.name} (${account.external_id})`);
            const histData = await fetchPortfolioHistory(account.external_id, key_id, keySecret);

            const epochMs = histData.epoch_ms || [];
            const series  = histData.series   || [];

            if (!epochMs.length) {
                console.warn(`[composer] No history returned for ${account.name}`);
                accountSummaries.push({ name: account.name, pointCount: 0 });
                continue;
            }

            // Convert parallel arrays → [{date, value}], skip zero-value rows.
            const points = epochMs
                .map((ms, i) => ({
                    date:  new Date(ms).toISOString().slice(0, 10),
                    value: parseFloat(series[i] ?? 0),
                }))
                .filter((p) => p.value > 0);

            // Bulk upsert into portfolio_history one row at a time.
            // ~479 rows per account — fast enough without a batched VALUES list.
            for (const pt of points) {
                await query(
                    `INSERT INTO portfolio_history
                       (user_id, account_id, history_date, portfolio_value, source)
                     VALUES ($1, $2, $3, $4, 'composer')
                     ON CONFLICT (account_id, history_date)
                     DO UPDATE SET portfolio_value = EXCLUDED.portfolio_value`,
                    [userId, account.id, pt.date, pt.value]
                );
            }

            totalRowsInserted += points.length;

            if (points.length > 0) {
                const sortedDates = points.map((p) => p.date).sort();
                const earliest    = sortedDates[0];
                const latest      = sortedDates[sortedDates.length - 1];
                if (!globalEarliest || earliest < globalEarliest) globalEarliest = earliest;
                if (!globalLatest   || latest   > globalLatest)   globalLatest   = latest;
                accountSummaries.push({ name: account.name, pointCount: points.length, earliest, latest });
            } else {
                accountSummaries.push({ name: account.name, pointCount: 0 });
            }

            // Respect Composer's 1 req/sec rate limit between accounts.
            await new Promise((r) => setTimeout(r, 1100));
        } catch (err) {
            console.error(`[composer] Backfill failed for ${account.name}:`, err.message);
            accountSummaries.push({ name: account.name, pointCount: 0, error: err.message });
        }
    }

    // After filling history, detect likely deposit events from large single-day
    // NAV jumps and auto-insert them into account_transfers so TWR calculations
    // can correctly subtract them.
    const detectionResult = await detectAndInsertComposerDeposits(userId);
    console.log(`[composer] Deposit detection: ${detectionResult.insertedCount} new deposits inserted`);

    return {
        accountsProcessed: accountSummaries.filter((a) => a.pointCount > 0).length,
        rowsInserted:      totalRowsInserted,
        accounts:          accountSummaries,
        dateRange:         { earliest: globalEarliest, latest: globalLatest },
        depositsDetected:  detectionResult,
    };
}

// ─── Composer deposit detection ───────────────────────────────────────────────

// Scans portfolio_history for day-over-day NAV jumps that are likely cash
// deposits rather than market gains and inserts them into account_transfers
// with source='composer_detected' so TWR calculations can subtract them.
//
// Detection criteria (all must be true):
//   • Day-over-day increase > $500 absolute
//   • Day-over-day increase > 3% of prior value
//   • Date gap between consecutive rows ≤ 5 days (guards against long data gaps
//     that could produce false positives over weekends/holidays)
//
// Safe to re-run: skips any date that already has an account_transfers row for
// the same account, whether manual or previously auto-detected.
//
// Returns { detectedCount, insertedCount, deposits: [{date, accountId, amount, pctChange}] }
export async function detectAndInsertComposerDeposits(userId) {
    // Window function to compare each day to the prior data point.
    const detected = await query(
        `WITH ranked AS (
             SELECT
                 history_date,
                 account_id,
                 portfolio_value,
                 LAG(history_date)    OVER (PARTITION BY account_id ORDER BY history_date) AS prev_date,
                 LAG(portfolio_value) OVER (PARTITION BY account_id ORDER BY history_date) AS prev_value
             FROM portfolio_history
             WHERE user_id = $1
         )
         SELECT
             account_id::text,
             history_date::text                                           AS date,
             (portfolio_value - prev_value)::float                       AS change_amount,
             CASE WHEN prev_value > 0
                  THEN ((portfolio_value - prev_value) / prev_value)::float
                  ELSE 0
             END                                                         AS pct_change,
             (history_date - prev_date)::int                             AS day_gap
         FROM ranked
         WHERE prev_value IS NOT NULL
           AND portfolio_value > prev_value
           AND portfolio_value - prev_value > 500
           AND CASE WHEN prev_value > 0
                   THEN (portfolio_value - prev_value) / prev_value
                   ELSE 0
               END > 0.03
           AND (history_date - prev_date) <= 5
         ORDER BY history_date`,
        [userId]
    );

    let insertedCount = 0;
    const deposits    = [];

    for (const dep of detected.rows) {
        // Skip if any transfer row already exists for this account+date to
        // prevent double-counting whether entered manually or detected before.
        const existing = await query(
            `SELECT 1 FROM account_transfers
             WHERE account_id = $1 AND transferred_at = $2
             LIMIT 1`,
            [dep.account_id, dep.date]
        );
        if (existing.rows.length > 0) continue;

        const pctStr = (dep.pct_change * 100).toFixed(1);
        await query(
            `INSERT INTO account_transfers
               (user_id, account_id, amount, transfer_type, transferred_at, notes, source)
             VALUES ($1, $2, $3, 'deposit', $4, $5, 'composer_detected')`,
            [
                userId,
                dep.account_id,
                dep.change_amount,
                dep.date,
                `Composer auto-detected deposit (+${pctStr}% single-day jump)`,
            ]
        );
        insertedCount++;
        deposits.push({
            date:      dep.date,
            accountId: dep.account_id,
            amount:    dep.change_amount,
            pctChange: dep.pct_change,
        });
    }

    return {
        detectedCount: detected.rows.length,
        insertedCount,
        deposits,
    };
}
