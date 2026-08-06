// Composer Direct API integration — personal API key mode.
// Accounts and balances are fetched server-side; the secret is never logged
// or returned to the client.

import { query } from '../db/client.js';
import { decryptSecret } from '../lib/secretCrypto.js';
import { takeSnapshot } from './snapshotService.js';

// Composer authenticates with Basic auth (keyId:keySecret). Adjust the
// Authorization header below if their API migrates to Bearer or another scheme.
export async function fetchComposerAccounts(keyId, keySecret) {
    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch('https://api.composer.trade/v1/accounts', {
        headers: {
            Authorization: `Basic ${credentials}`,
            Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        const msg = String(body).split('\n')[0].slice(0, 200);
        throw new Error(`Composer API ${response.status}: ${msg || response.statusText}`);
    }

    const data = await response.json();
    // Composer may return a top-level array or { accounts: [...] }
    return Array.isArray(data) ? data : (Array.isArray(data?.accounts) ? data.accounts : []);
}

// Upserts Composer accounts into the `accounts` table for a single user and
// bumps synced_at. Returns { accountsUpdated }.
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
        // Normalise across Composer response shapes
        const name       = ca.name || ca.title || ca.label || String(ca.id || 'Composer Account');
        const balance    = Number(ca.balance ?? ca.portfolio_value ?? ca.total_value ?? ca.nav ?? 0);
        const externalId = String(ca.id ?? ca.account_id ?? name);

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
