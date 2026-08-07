import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { requireProfile } from '../middleware/profile.js';
import { query } from '../db/client.js';

const router = Router();

const TRANSFER_TYPES = ['deposit', 'withdrawal', 'transfer_in', 'transfer_out'];

// List all transfers for the authenticated user, newest first.
router.get('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const result = await query(
            `SELECT t.id,
                    t.account_id,
                    a.name        AS account_name,
                    a.type        AS account_type,
                    t.amount,
                    t.transfer_type,
                    t.transferred_at::text AS transferred_at,
                    t.notes,
                    t.created_at
             FROM account_transfers t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.user_id = $1
               AND ($2::int IS NULL OR a.profile_id = $2)
             ORDER BY t.transferred_at DESC, t.created_at DESC`,
            [req.user.id, req.profileId]
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load transfers' });
    }
});

// Log a new cash flow event.
// amount is always passed as a positive number; the sign is derived from transfer_type.
router.post('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const { accountId, amount, transferType, transferredAt, notes } = req.body || {};

        if (!accountId) {
            return res.status(400).json({ error: 'accountId is required' });
        }
        const parsedAmount = Number(amount);
        if (!parsedAmount || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'amount must be a positive number' });
        }
        if (!TRANSFER_TYPES.includes(transferType)) {
            return res.status(400).json({ error: `transferType must be one of: ${TRANSFER_TYPES.join(', ')}` });
        }
        if (!transferredAt) {
            return res.status(400).json({ error: 'transferredAt is required' });
        }

        // Verify the account belongs to this user.
        const acctCheck = await query(
            `SELECT id FROM accounts WHERE id = $1 AND user_id = $2`,
            [accountId, req.user.id]
        );
        if (!acctCheck.rowCount) {
            return res.status(404).json({ error: 'Account not found' });
        }

        // Sign convention: deposits and transfer_in are positive; withdrawals and transfer_out are negative.
        const signed = ['withdrawal', 'transfer_out'].includes(transferType)
            ? -Math.abs(parsedAmount)
            : Math.abs(parsedAmount);

        const result = await query(
            `INSERT INTO account_transfers
               (user_id, account_id, amount, transfer_type, transferred_at, notes)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, account_id, amount, transfer_type,
                       transferred_at::text AS transferred_at, notes, created_at`,
            [req.user.id, accountId, signed, transferType, transferredAt, notes?.trim() || null]
        );
        return res.status(201).json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to create transfer' });
    }
});

// Delete a single transfer by id.
router.delete('/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const deleted = await query(
            `DELETE FROM account_transfers WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id]
        );
        if (!deleted.rowCount) {
            return res.status(404).json({ error: 'Transfer not found' });
        }
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to delete transfer' });
    }
});

export default router;
