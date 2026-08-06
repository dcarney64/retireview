import { Router } from 'express';

import { requireAdmin } from '../auth/middleware.js';
import { query } from '../db/client.js';
import { reconstructHistoryForUser } from '../services/historyReconstructService.js';
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

        // Detect first-ever sync (no snaptrade accounts yet) so we can trigger
        // history reconstruction after the sync imports transaction history.
        const existingResult = await query(
            `SELECT 1 FROM accounts WHERE user_id = $1 AND source = 'snaptrade' LIMIT 1`,
            [req.user.id]
        );
        const isFirstSync = existingResult.rowCount === 0;

        const summary = await syncAccountsForUser(req.user.id);

        // On the first sync, automatically reconstruct historical monthly snapshots
        // from the transaction history that was just pulled, so the Performance page
        // shows real data immediately instead of "not enough data".
        let reconstruction = null;
        if (isFirstSync && summary.txInserted > 0) {
            try {
                reconstruction = await reconstructHistoryForUser(req.user.id);
                console.log(
                    `[snaptrade] First sync reconstruction: ${reconstruction.monthsReconstructed} months, `
                    + `${reconstruction.earliestDate} → ${reconstruction.latestDate}`
                );
            } catch (recErr) {
                console.error('[snaptrade] First-sync reconstruction failed:', recErr.message);
            }
        }

        return res.json({ ...summary, reconstruction });
    } catch (error) {
        return res.status(502).json({ error: upstreamError(error, 'SnapTrade sync failed') });
    }
});

export default router;
