import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';
import { decryptSecret, encryptSecret } from '../lib/secretCrypto.js';
import { fetchComposerAccounts, syncComposerAccountsForUser, testConnection } from '../services/composerService.js';

const router = Router();

// Returns first 4 + •••• + last 4 characters. Safe for IDs shorter than 8 chars.
function maskKeyId(keyId) {
    if (!keyId) return '';
    const s = String(keyId);
    if (s.length < 8) return '••••••••';
    return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

// ─── GET /api/connections/composer ───────────────────────────────────────────
// Returns { configured, keyIdMasked, syncedAt, balance }. Never returns the
// plaintext secret or the full key ID.
router.get('/composer', requireAuth, async (req, res) => {
    try {
        const credResult = await query(
            'SELECT key_id, synced_at FROM composer_credentials WHERE user_id = $1',
            [req.user.id]
        );

        if (credResult.rows.length === 0) {
            return res.json({ configured: false, keyIdMasked: null, syncedAt: null, balance: null });
        }

        const { key_id, synced_at } = credResult.rows[0];

        const balResult = await query(
            `SELECT COALESCE(SUM(balance), 0)::numeric AS total
             FROM accounts
             WHERE user_id = $1 AND source = 'composer'`,
            [req.user.id]
        );

        return res.json({
            configured: true,
            keyIdMasked: maskKeyId(key_id),
            syncedAt: synced_at,
            balance: Number(balResult.rows[0]?.total ?? 0),
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/connections/composer ──────────────────────────────────────────
// Accepts { keyId, keySecret }. Encrypts the secret and stores/replaces creds.
router.post('/composer', requireAuth, async (req, res) => {
    const { keyId, keySecret } = req.body || {};

    if (!keyId || !keySecret) {
        return res.status(400).json({ error: 'keyId and keySecret are required' });
    }
    if (typeof keyId !== 'string' || typeof keySecret !== 'string') {
        return res.status(400).json({ error: 'keyId and keySecret must be strings' });
    }
    if (keyId.length > 256 || keySecret.length > 512) {
        return res.status(400).json({ error: 'keyId or keySecret exceeds maximum length' });
    }

    try {
        const encryptedSecret = encryptSecret(keySecret);

        await query(
            `INSERT INTO composer_credentials (user_id, key_id, key_secret_enc)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET
               key_id         = EXCLUDED.key_id,
               key_secret_enc = EXCLUDED.key_secret_enc,
               updated_at     = NOW()`,
            [req.user.id, keyId, encryptedSecret]
        );

        return res.json({ configured: true, keyIdMasked: maskKeyId(keyId) });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// ─── DELETE /api/connections/composer ────────────────────────────────────────
// Removes stored credentials for this user. Does not delete synced accounts.
router.delete('/composer', requireAuth, async (req, res) => {
    try {
        await query('DELETE FROM composer_credentials WHERE user_id = $1', [req.user.id]);
        return res.json({ configured: false });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// ─── POST /api/connections/composer/test ─────────────────────────────────────
// Verifies connectivity to Composer API.
// Body { keyId, keySecret }: tests those credentials without saving (disconnected
//   state "Test Connection" button).
// Empty body: tests the stored credentials (connected state "Test" button).
router.post('/composer/test', requireAuth, async (req, res) => {
    try {
        let keyId;
        let keySecret;

        if (req.body?.keyId && req.body?.keySecret) {
            keyId     = String(req.body.keyId);
            keySecret = String(req.body.keySecret);
        } else {
            const credResult = await query(
                'SELECT key_id, key_secret_enc FROM composer_credentials WHERE user_id = $1',
                [req.user.id]
            );

            if (credResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'No credentials stored' });
            }

            keyId     = credResult.rows[0].key_id;
            keySecret = decryptSecret(credResult.rows[0].key_secret_enc);
        }

        // Use testConnection (fast, list-only) — not fetchComposerAccounts which
        // fetches per-account balance stats and would be slow for a connectivity check.
        const result = await testConnection(keyId, keySecret);
        return res.json(result);
    } catch (error) {
        // Return 200 with success:false so the UI can show the error message cleanly
        return res.json({ success: false, error: String(error.message).split('\n')[0] });
    }
});

// ─── GET /api/connections/composer/accounts ──────────────────────────────────
// Returns the live list of Composer portfolios so the Accounts page can let
// the user pick which ones to add. Normalised to { id, name, value }.
router.get('/composer/accounts', requireAuth, async (req, res) => {
    try {
        const credResult = await query(
            'SELECT key_id, key_secret_enc FROM composer_credentials WHERE user_id = $1',
            [req.user.id]
        );

        if (credResult.rows.length === 0) {
            return res.status(404).json({ error: 'Composer not connected' });
        }

        const { key_id, key_secret_enc } = credResult.rows[0];
        // fetchComposerAccounts returns [{ id, name, value, currency, type, status }]
        const accounts = await fetchComposerAccounts(key_id, decryptSecret(key_secret_enc));
        return res.json({ accounts });
    } catch (error) {
        return res.status(502).json({ error: String(error.message).split('\n')[0] });
    }
});

// ─── POST /api/connections/composer/sync ─────────────────────────────────────
// Pulls account balances from Composer and updates matching rows in `accounts`.
router.post('/composer/sync', requireAuth, async (req, res) => {
    try {
        const credResult = await query(
            'SELECT 1 FROM composer_credentials WHERE user_id = $1',
            [req.user.id]
        );

        if (credResult.rows.length === 0) {
            return res.status(404).json({ error: 'No Composer credentials configured' });
        }

        const result = await syncComposerAccountsForUser(req.user.id);
        return res.json({ synced: true, accountsUpdated: result.accountsUpdated });
    } catch (error) {
        return res.status(502).json({ error: String(error.message).split('\n')[0] });
    }
});

export default router;
