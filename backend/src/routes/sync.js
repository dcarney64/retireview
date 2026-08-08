import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { syncComposerAccountsForUser } from '../services/composerService.js';
import { takeSnapshot } from '../services/snapshotService.js';
import {
    isConfigured as snaptradeConfigured,
    syncAccountsForUser,
} from '../services/snaptradeService.js';

const router = Router();

// ─── POST /api/sync/all ───────────────────────────────────────────────────────
// Runs SnapTrade + Composer syncs then takes an auto-snapshot.
// Each step is individually caught so one failure never blocks the others.
// Returns a structured summary of what ran and how many accounts were updated.
router.post('/all', requireAuth, async (req, res) => {
    const userId = req.user.id;
    const out = { success: true, syncedAt: new Date().toISOString() };

    // ── SnapTrade ──────────────────────────────────────────────────────────────
    try {
        if (!snaptradeConfigured()) {
            out.snaptrade = { success: true, skipped: true, reason: 'SnapTrade not configured' };
        } else {
            const r = await syncAccountsForUser(userId);
            out.snaptrade = {
                success: true,
                accountsUpdated: (r.created || 0) + (r.updated || 0),
                created:  r.created  ?? 0,
                updated:  r.updated  ?? 0,
                failures: r.failures ?? 0,
            };
        }
    } catch (err) {
        out.snaptrade = { success: false, error: String(err.message).split('\n')[0] };
    }

    // ── Composer ───────────────────────────────────────────────────────────────
    try {
        const r = await syncComposerAccountsForUser(userId);
        if (r.skipped) {
            out.composer = { success: true, skipped: true, reason: 'No Composer credentials found' };
        } else {
            out.composer = { success: true, accountsUpdated: r.accountsUpdated };
        }
    } catch (err) {
        out.composer = { success: false, error: String(err.message).split('\n')[0] };
    }

    // ── Snapshot ───────────────────────────────────────────────────────────────
    try {
        const snap = await takeSnapshot(userId, null, 'auto: sync all');
        if (snap?.skipped) {
            out.snapshot = { success: true, skipped: true, reason: snap.reason };
        } else {
            out.snapshot = { success: true, total: Number(snap?.snapshot?.total ?? 0) };
        }
    } catch (err) {
        out.snapshot = { success: false, error: String(err.message).split('\n')[0] };
    }

    return res.json(out);
});

export default router;
