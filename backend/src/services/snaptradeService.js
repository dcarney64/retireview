// SnapTrade integration — PERSONAL API key mode (docs.snaptrade.com/docs/build-with-ai).
// The key identifies the app owner: brokerage connections are created and
// repaired in the SnapTrade Dashboard, not in-app, and every call here is
// read-only account/balance data. Server-side only; never log full responses.
import { Snaptrade, SnaptradeAuth } from 'snaptrade-typescript-sdk';

import { query } from '../db/client.js';

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
                clientId: process.env.SNAPTRADE_CLIENT_ID,
                consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
            }),
        });
    }
    return client;
}

export function getDashboardUrl() {
    // Where brokerage connections are added/repaired in personal-key mode
    return process.env.SNAPTRADE_DASHBOARD_URL || 'https://dashboard.snaptrade.com';
}

// Normalized connection status list
export async function listConnections() {
    const snaptrade = getClient();
    const response = await snaptrade.connections.listBrokerageAuthorizations();
    return (response.data || []).map((auth) => ({
        id: auth.id,
        brokerage: auth.brokerage?.display_name || auth.brokerage?.name || 'Unknown',
        disabled: Boolean(auth.disabled),
        createdAt: auth.created_date || null,
    }));
}

// Fetches all brokerage accounts with balances, normalized to small view
// models. Per-account failures are reported, never masked with mock values.
export async function fetchBrokerageAccounts() {
    const snaptrade = getClient();
    const accountsResponse = await snaptrade.accountInformation.listUserAccounts();
    const accounts = accountsResponse.data || [];

    const settled = await Promise.allSettled(
        accounts.map(async (account) => {
            const accountId = account.id;
            let total = account.balance?.total?.amount;
            let currency = account.balance?.total?.currency || 'USD';

            // Some brokerages omit the rolled-up total; fall back to the
            // balance endpoint and sum cash across currency entries.
            if (total === null || total === undefined) {
                const balanceResponse = await snaptrade.accountInformation.getUserAccountBalance({ accountId });
                const balances = balanceResponse.data || [];
                total = balances.reduce((sum, b) => sum + (Number(b.cash) || 0), 0);
                currency = balances[0]?.currency?.code || currency;
            }

            return {
                externalId: accountId,
                name: account.name || account.number || 'Brokerage account',
                institution: account.institution_name || null,
                total: Number(total) || 0,
                currency,
            };
        })
    );

    const results = [];
    const failures = [];
    settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
            results.push(outcome.value);
        } else {
            failures.push({
                externalId: accounts[index]?.id || null,
                name: accounts[index]?.name || 'Unknown account',
                // First line only — SDK errors embed full response headers
                error: String(outcome.reason?.message || 'Failed to fetch balance').split('\n')[0],
            });
        }
    });

    return { accounts: results, failures };
}

// Upserts SnapTrade balances into the user's accounts. Linked accounts
// (matched on external_id) get a fresh balance; new SnapTrade accounts are
// created as type 'brokerage' (re-typeable in the UI — sync never changes
// type, name, or notes after creation). Manual accounts are never touched,
// and accounts are never deleted here.
export async function syncAccountsForUser(userId) {
    const { accounts, failures } = await fetchBrokerageAccounts();

    let created = 0;
    let updated = 0;

    for (const account of accounts) {
        const existing = await query(
            `SELECT id FROM accounts WHERE user_id = $1 AND external_id = $2 LIMIT 1`,
            [userId, account.externalId]
        );

        if (existing.rowCount) {
            await query(
                `UPDATE accounts
                 SET balance = $3, institution = $4, last_synced_at = now(), updated_at = now()
                 WHERE id = $1 AND user_id = $2`,
                [existing.rows[0].id, userId, account.total, account.institution]
            );
            updated += 1;
        } else {
            await query(
                `INSERT INTO accounts (user_id, name, type, balance, notes, source, external_id, institution, last_synced_at)
                 VALUES ($1, $2, 'brokerage', $3, NULL, 'snaptrade', $4, $5, now())`,
                [userId, account.name, account.total, account.externalId, account.institution]
            );
            created += 1;
        }
    }

    return { created, updated, failures };
}
