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

    let accountsUpdated = 0;

    for (const ca of composerAccounts) {
        await query(
            `INSERT INTO accounts
               (user_id, name, type, balance, source, external_id, institution, last_synced_at, updated_at)
             VALUES ($1, $2, 'composer', $3, 'composer', $4, 'Composer', NOW(), NOW())
             ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL
             DO UPDATE SET
               balance        = EXCLUDED.balance,
               last_synced_at = NOW(),
               updated_at     = NOW()`,
            [userId, ca.name, ca.value, ca.id]
        );
        accountsUpdated++;
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
