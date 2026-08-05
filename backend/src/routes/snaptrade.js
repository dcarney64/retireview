import { Router } from 'express';

import { requireAdmin } from '../auth/middleware.js';
import { query } from '../db/client.js';
import {
    getDashboardUrl,
    isConfigured,
    listConnections,
    syncAccountsForUser,
} from '../services/snaptradeService.js';

// Admin-only by design: a personal SnapTrade API key exposes the app
// owner's brokerage data, so only the owner (admin) may see or sync it.
// If you switch to SnapTrade Commercial (per-user connections), relax
// this to requireAuth and add per-user registration.
const router = Router();

// SDK errors embed full response headers in the message; keep the first
// line only so upstream details never leak into responses or logs.
function upstreamError(error, fallback) {
    return String(error?.message || fallback).split('\n')[0];
}

router.get('/status', requireAdmin, async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.json({ configured: false, connections: [], linkedAccounts: 0, lastSyncedAt: null });
        }

        const [connections, linked] = await Promise.all([
            listConnections(),
            query(
                `SELECT COUNT(*)::int AS count, MAX(last_synced_at) AS last_synced_at
                 FROM accounts
                 WHERE user_id = $1 AND source = 'snaptrade'`,
                [req.user.id]
            ),
        ]);

        return res.json({
            configured: true,
            dashboardUrl: getDashboardUrl(),
            connections,
            linkedAccounts: linked.rows[0].count,
            lastSyncedAt: linked.rows[0].last_synced_at,
        });
    } catch (error) {
        return res.status(502).json({ error: upstreamError(error, 'Failed to reach SnapTrade') });
    }
});

router.get('/connect-url', requireAdmin, (_req, res) => {
    // Personal-key mode: connections are added in the SnapTrade Dashboard
    return res.json({ url: getDashboardUrl() });
});

router.post('/sync', requireAdmin, async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                error: 'SnapTrade is not configured — set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY',
            });
        }

        const summary = await syncAccountsForUser(req.user.id);
        return res.json(summary);
    } catch (error) {
        return res.status(502).json({ error: upstreamError(error, 'SnapTrade sync failed') });
    }
});

export default router;
