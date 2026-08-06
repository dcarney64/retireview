// Composer.trade API integration.
// Docs: https://api.composer.trade/docs/index.html
// Base URL: https://api.composer.trade
//
// Auth — two headers required on every request:
//   x-api-key-id:   <COMPOSER_API_KEY_ID>
//   authorization:  Bearer <COMPOSER_API_SECRET>
//
// Rate limit: 1 req/sec on most endpoints.

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

// ─── Connection test ──────────────────────────────────────────────────────────

// Returns { success, error? }
export async function testConnection(apiKeyId, apiSecret) {
    try {
        const response = await composerFetch('/api/v0.1/accounts/list', apiKeyId, apiSecret);
        if (response.ok) {
            return { success: true };
        }
        const text = await response.text().catch(() => '');
        return { success: false, error: `HTTP ${response.status}${text ? ': ' + text : ''}` };
    } catch (error) {
        return { success: false, error: error.message || 'Network error' };
    }
}

// ─── Accounts list ────────────────────────────────────────────────────────────

// GET /api/v0.1/accounts/list
// Returns [{ composerAccountId, name, value, currency, type, status }]
// Also exported as fetchComposerAccounts for backward-compat with connections route.
export async function fetchComposerAccounts(apiKeyId, apiSecret) {
    const response = await composerFetch('/api/v0.1/accounts/list', apiKeyId, apiSecret);
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Composer API error ${response.status}${text ? ': ' + text : ''}`);
    }
    const data = await response.json();

    // Response shape: { accounts: [...] } or bare array
    const raw = Array.isArray(data) ? data : (data.accounts ?? data.data ?? []);
    return raw.map((a) => ({
        composerAccountId: String(a.account_uuid ?? a.id ?? ''),
        name: a.account_name ?? a.name ?? `Account ${a.account_uuid ?? ''}`,
        value: parseFloat(a.equity ?? a.portfolio_value ?? a.value ?? a.balance ?? 0),
        currency: a.currency ?? 'USD',
        type: a.account_type ?? a.type ?? null,
        status: a.status ?? null,
    }));
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
// Reads credentials from composer_credentials; updates matching rows in accounts.
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
        const name       = ca.name;
        const balance    = ca.value;
        const externalId = ca.composerAccountId || name;

        await query(
            `INSERT INTO accounts
               (user_id, name, type, balance, source, external_id, institution, last_synced_at, updated_at)
             VALUES ($1, $2, 'composer', $3, 'composer', $4, 'Composer', NOW(), NOW())
             ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL
             DO UPDATE SET
               balance        = EXCLUDED.balance,
               last_synced_at = NOW(),
               updated_at     = NOW()`,
            [userId, name, balance, externalId]
        );
        accountsUpdated++;
    }

    await query(
        'UPDATE composer_credentials SET synced_at = NOW(), updated_at = NOW() WHERE user_id = $1',
        [userId]
    );

    // Auto-snapshot after every sync (manual and nightly).
    try {
        await takeSnapshot(userId, 'auto: composer sync');
    } catch (snapErr) {
        console.error('[composer] Auto-snapshot failed:', snapErr.message);
    }

    return { accountsUpdated };
}
