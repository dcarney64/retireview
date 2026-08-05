import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';
import { takeSnapshot } from '../services/snapshotService.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT s.id, s.total, s.note, s.snapped_at, s.created_at,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'accountId', asn.account_id,
                                'name', a.name,
                                'type', a.type,
                                'balance', asn.balance
                            )
                            ORDER BY a.type, a.name
                        ) FILTER (WHERE asn.id IS NOT NULL),
                        '[]'
                    ) AS accounts
             FROM snapshots s
             LEFT JOIN account_snapshots asn ON asn.snapshot_id = s.id
             LEFT JOIN accounts a ON a.id = asn.account_id
             WHERE s.user_id = $1
             GROUP BY s.id
             ORDER BY s.snapped_at DESC`,
            [req.user.id]
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load snapshots' });
    }
});

// Captures current account balances as a point-in-time record.
// One snapshot per day: snapping again today replaces today's snapshot.
router.post('/', requireAuth, async (req, res) => {
    try {
        const { note } = req.body || {};
        const result = await takeSnapshot(req.user.id, note);

        if (result.skipped) {
            return res.status(400).json({ error: 'Add at least one account before taking a snapshot' });
        }

        return res.status(201).json(result.snapshot);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to take snapshot' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await query(
            `DELETE FROM snapshots WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id]
        );

        if (!deleted.rowCount) {
            return res.status(404).json({ error: 'Snapshot not found' });
        }

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to delete snapshot' });
    }
});

export default router;
