// SnapTrade integration — PERSONAL API key mode (docs.snaptrade.com/docs/build-with-ai).
// The key identifies the app owner: brokerage connections are created and
// repaired in the SnapTrade Dashboard, not in-app, and every call here is
// read-only account/balance/transaction data. Server-side only; never log
// full responses.
import { Snaptrade, SnaptradeAuth } from 'snaptrade-typescript-sdk';

import { query } from '../db/client.js';
import { takeSnapshot } from './snapshotService.js';

let client = null;

export function isConfigured() {
    return Boolean(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY);
}

function getClient() {
    if (!isConfigured()) {
        throw new Error('SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY must be configured');
    }
    if (!client) {
        client = new Snaptrade({
            auth: SnaptradeAuth.personalApiKey({
                clientId:    process.env.SNAPTRADE_CLIENT_ID,
                consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
            }),
        });
    }
    return client;
}

export function getDashboardUrl() {
    return process.env.SNAPTRADE_DASHBOARD_URL || 'https://dashboard.snaptrade.com';
}

// ─── SnapTrade type → account_transfers.transfer_type ────────────────────────
// Only these four types generate automatic transfer records used for TWR.
const CASH_FLOW_TYPE_MAP = {
    CONTRIBUTION:                'deposit',
    WITHDRAWAL:                  'withdrawal',
    EXTERNAL_ASSET_TRANSFER_IN:  'transfer_in',
    EXTERNAL_ASSET_TRANSFER_OUT: 'transfer_out',
};

// ─── Connections ─────────────────────────────────────────────────────────────

export async function listConnections() {
    const snaptrade = getClient();
    const response = await snaptrade.connections.listBrokerageAuthorizations();
    return (response.data || []).map((auth) => ({
        id:        auth.id,
        brokerage: auth.brokerage?.display_name || auth.brokerage?.name || 'Unknown',
        disabled:  Boolean(auth.disabled),
        createdAt: auth.created_date || null,
    }));
}

// ─── Balance sync ─────────────────────────────────────────────────────────────

// Fetches all brokerage accounts with balances, normalized to small view models.
// Per-account failures are reported, never masked with mock values.
export async function fetchBrokerageAccounts() {
    const snaptrade = getClient();
    const accountsResponse = await snaptrade.accountInformation.listUserAccounts();
    const accounts = accountsResponse.data || [];

    const settled = await Promise.allSettled(
        accounts.map(async (account) => {
            const accountId = account.id;
            let total    = account.balance?.total?.amount;
            let currency = account.balance?.total?.currency || 'USD';

            // Some brokerages omit the rolled-up total; fall back to the
            // balance endpoint and sum cash across currency entries.
            if (total === null || total === undefined) {
                const balanceResponse = await snaptrade.accountInformation.getUserAccountBalance({ accountId });
                const balances = balanceResponse.data || [];
                total    = balances.reduce((sum, b) => sum + (Number(b.cash) || 0), 0);
                currency = balances[0]?.currency?.code || currency;
            }

            return {
                externalId:  accountId,
                name:        account.name || account.number || 'Brokerage account',
                institution: account.institution_name || null,
                total:       Number(total) || 0,
                currency,
            };
        })
    );

    const results  = [];
    const failures = [];
    settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
            results.push(outcome.value);
        } else {
            failures.push({
                externalId: accounts[index]?.id   || null,
                name:       accounts[index]?.name || 'Unknown account',
                error:      String(outcome.reason?.message || 'Failed to fetch balance').split('\n')[0],
            });
        }
    });

    return { accounts: results, failures };
}

// ─── Transaction sync ─────────────────────────────────────────────────────────

/**
 * Fetch one page of activities for a SnapTrade account.
 * Returns { activities: [...], total: number }.
 *
 * The API response body is { data: [...], pagination: { offset, limit, total } }.
 * The SDK surfaces this as response.data (the parsed JSON body).
 */
async function fetchActivitiesPage(snaptrade, externalAccountId, startDate, offset) {
    const response = await snaptrade.accountInformation.getAccountActivities({
        accountId: externalAccountId,
        ...(startDate ? { startDate } : {}),
        offset,
        limit: 1000,
    });

    const body       = response.data;
    // Handle both direct-array (some SDK versions) and wrapped { data, pagination } shapes.
    const activities = Array.isArray(body) ? body : (body?.data || []);
    const total      = body?.pagination?.total ?? activities.length;
    return { activities, total };
}

/**
 * Fetch ALL activities for a SnapTrade account, walking through pages.
 * Pass startDate (YYYY-MM-DD) for incremental pull, or null for full history.
 */
async function fetchAllActivities(snaptrade, externalAccountId, startDate) {
    const all   = [];
    let offset  = 0;
    const LIMIT = 1000;

    for (;;) {
        const { activities, total } = await fetchActivitiesPage(snaptrade, externalAccountId, startDate, offset);
        all.push(...activities);
        offset += activities.length;
        // Stop when we got a partial page or hit the reported total.
        if (activities.length < LIMIT || (total && offset >= total)) break;
    }

    return all;
}

/**
 * Sync transaction history for one account.
 *
 * Strategy:
 *  - If no prior transactions exist → pull full history (startDate = null).
 *  - Otherwise → pull from (last_known_date − 7 days) to catch late-settling trades.
 *
 * For each activity:
 *  1. Upsert into account_transactions (idempotent on external_id).
 *  2. On a NEW insert only: if it's a cash-flow type (CONTRIBUTION, WITHDRAWAL,
 *     EXTERNAL_ASSET_TRANSFER_IN/OUT), also insert a matching account_transfers row
 *     so TWR is automatically correct without manual user input.
 *     Uses snaptrade_tx_id for conflict dedup on account_transfers.
 *
 * Returns { fetched, inserted, transfersCreated }.
 */
async function syncTransactionsForAccount(userId, internalAccountId, externalAccountId) {
    const snaptrade = getClient();

    // Determine the start date for this sync pass.
    const lastResult = await query(
        `SELECT MAX(transacted_at) AS last_date FROM account_transactions WHERE account_id = $1`,
        [internalAccountId]
    );
    let startDate = null;
    if (lastResult.rows[0]?.last_date) {
        const d = new Date(lastResult.rows[0].last_date);
        d.setDate(d.getDate() - 7); // 7-day look-back catches late-settling trades
        startDate = d.toISOString().slice(0, 10);
    }

    const activities = await fetchAllActivities(snaptrade, externalAccountId, startDate);

    let inserted         = 0;
    let transfersCreated = 0;

    for (const activity of activities) {
        if (!activity.id) continue;

        // Prefer trade_date; fall back to settlement_date.
        const rawDate = activity.trade_date || activity.settlement_date;
        if (!rawDate) continue;
        const transactedAt = String(rawDate).slice(0, 10); // YYYY-MM-DD

        const txType      = activity.type || 'UNKNOWN';
        const amount      = activity.amount != null ? Number(activity.amount) : null;
        const price       = activity.price  != null ? Number(activity.price)  : null;
        const units       = activity.units  != null ? Number(activity.units)  : null;
        const symbol      = activity.symbol?.symbol
                         || activity.currency_universal_symbol?.symbol
                         || null;
        const currency    = activity.currency?.code || 'USD';
        const description = activity.description || null;

        // ── 1. Upsert transaction ──────────────────────────────────────────────
        // (xmax = 0) is true only when the row was newly INSERTed, not when the
        // ON CONFLICT branch ran — this lets us distinguish first-seen from re-sync.
        const upsert = await query(
            `INSERT INTO account_transactions
               (user_id, account_id, external_id, transaction_type, amount, price,
                units, symbol, currency, transacted_at, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (account_id, external_id) DO UPDATE
               SET transaction_type = EXCLUDED.transaction_type,
                   amount           = EXCLUDED.amount,
                   description      = EXCLUDED.description,
                   transacted_at    = EXCLUDED.transacted_at
             RETURNING id, (xmax = 0) AS is_new`,
            [userId, internalAccountId, activity.id, txType, amount, price,
             units, symbol, currency, transactedAt, description]
        );

        const row = upsert.rows[0];
        if (!row?.is_new) continue; // already processed on a previous sync
        inserted++;

        // ── 2. Auto-create account_transfers for cash-flow events ─────────────
        const transferType = CASH_FLOW_TYPE_MAP[txType];
        if (!transferType || amount == null || amount === 0) continue;

        // Sign convention: deposits/transfer_in positive, withdrawals/transfer_out negative.
        const signedAmount = ['withdrawal', 'transfer_out'].includes(transferType)
            ? -Math.abs(amount)
            : Math.abs(amount);

        // snaptrade_tx_id provides idempotency via a partial unique index:
        //   CREATE UNIQUE INDEX ON account_transfers (snaptrade_tx_id)
        //   WHERE snaptrade_tx_id IS NOT NULL
        await query(
            `INSERT INTO account_transfers
               (user_id, account_id, amount, transfer_type, transferred_at,
                notes, source, snaptrade_tx_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'snaptrade', $7)
             ON CONFLICT (snaptrade_tx_id)
             WHERE snaptrade_tx_id IS NOT NULL
             DO NOTHING`,
            [
                userId,
                internalAccountId,
                signedAmount,
                transferType,
                transactedAt,
                description ? `${txType}: ${description}` : txType,
                activity.id,
            ]
        );
        transfersCreated++;
    }

    return { fetched: activities.length, inserted, transfersCreated };
}

// ─── Main sync entry point ────────────────────────────────────────────────────

/**
 * Sync balances and transaction history for all SnapTrade accounts belonging
 * to userId.
 *
 * Balance sync always runs first. Transaction sync runs per-account and logs
 * but does not propagate individual account failures, so a bad account can't
 * abort the sync for the others.
 *
 * Returns { created, updated, failures, txInserted, transfersCreated }.
 */
export async function syncAccountsForUser(userId) {
    const { accounts, failures } = await fetchBrokerageAccounts();

    let created          = 0;
    let updated          = 0;
    let txInserted       = 0;
    let transfersCreated = 0;

    for (const account of accounts) {
        // ── Balance upsert ──────────────────────────────────────────────────────
        const existing = await query(
            `SELECT id FROM accounts WHERE user_id = $1 AND external_id = $2 LIMIT 1`,
            [userId, account.externalId]
        );

        let internalId;
        if (existing.rowCount) {
            await query(
                `UPDATE accounts
                 SET balance = $3, institution = $4, last_synced_at = now(), updated_at = now()
                 WHERE id = $1 AND user_id = $2`,
                [existing.rows[0].id, userId, account.total, account.institution]
            );
            internalId = existing.rows[0].id;
            updated   += 1;
        } else {
            const newRow = await query(
                `INSERT INTO accounts
                   (user_id, name, type, balance, notes, source, external_id, institution, last_synced_at)
                 VALUES ($1, $2, 'brokerage', $3, NULL, 'snaptrade', $4, $5, now())
                 RETURNING id`,
                [userId, account.name, account.total, account.externalId, account.institution]
            );
            internalId = newRow.rows[0].id;
            created   += 1;
        }

        // ── Transaction sync (non-fatal per account) ────────────────────────────
        try {
            const txResult = await syncTransactionsForAccount(userId, internalId, account.externalId);
            txInserted       += txResult.inserted;
            transfersCreated += txResult.transfersCreated;
        } catch (txErr) {
            // First line only — SnapTrade SDK errors embed full HTTP response headers
            console.error(
                `[SnapTrade] Transaction sync failed for ${account.externalId}:`,
                String(txErr?.message || txErr).split('\n')[0]
            );
        }
    }

    // Auto-snapshot after every sync (manual and nightly) so the Performance
    // page always has an up-to-date data point without user action.
    try {
        await takeSnapshot(userId, 'auto: snaptrade sync');
    } catch (snapErr) {
        console.error('[snaptrade] Auto-snapshot failed:', snapErr.message);
    }

    return { created, updated, failures, txInserted, transfersCreated };
}
