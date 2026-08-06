import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

export const ACCOUNT_TYPES = [
    'brokerage', 'composer', 'retirement', 'pension', 'real_estate', 'cash', 'other',
];

function validateAccountInput({ name, type, balance }, { partial = false } = {}) {
    if (!partial || name !== undefined) {
        if (!name || !String(name).trim()) {
            return 'name is required';
        }
    }
    if (!partial || type !== undefined) {
        if (!ACCOUNT_TYPES.includes(type)) {
            return `type must be one of: ${ACCOUNT_TYPES.join(', ')}`;
        }
    }
    if (balance !== undefined && balance !== null && !Number.isFinite(Number(balance))) {
        return 'balance must be a number';
    }
    return null;
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, type, balance, notes, source, institution,
                    last_synced_at, include_in_tracking, fidelity_account_number,
                    created_at, updated_at
             FROM accounts
             WHERE user_id = $1
             ORDER BY type, name`,
            [req.user.id]
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load accounts' });
    }
});

router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, type, balance, notes } = req.body || {};

        const invalid = validateAccountInput({ name, type, balance });
        if (invalid) {
            return res.status(400).json({ error: invalid });
        }

        const created = await query(
            `INSERT INTO accounts (user_id, name, type, balance, notes)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, type, balance, notes, include_in_tracking,
                       fidelity_account_number, created_at, updated_at`,
            [req.user.id, String(name).trim(), type, Number(balance) || 0, notes?.trim() || null]
        );
        return res.status(201).json(created.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to create account' });
    }
});

router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { name, type, balance, notes, include_in_tracking } = req.body || {};

        const invalid = validateAccountInput({ name, type, balance }, { partial: true });
        if (invalid) {
            return res.status(400).json({ error: invalid });
        }

        // include_in_tracking must be boolean if provided
        if (include_in_tracking !== undefined && typeof include_in_tracking !== 'boolean') {
            return res.status(400).json({ error: 'include_in_tracking must be a boolean' });
        }

        const updated = await query(
            `UPDATE accounts
             SET
                 name = COALESCE($3, name),
                 type = COALESCE($4, type),
                 -- Synced balances belong to SnapTrade; manual edits can't override them
                 balance = CASE WHEN source = 'snaptrade' THEN balance ELSE COALESCE($5, balance) END,
                 notes = CASE WHEN $6 THEN $7 ELSE notes END,
                 include_in_tracking = CASE WHEN $8 THEN $9 ELSE include_in_tracking END,
                 updated_at = now()
             WHERE id = $1 AND user_id = $2
             RETURNING id, name, type, balance, notes, source, institution,
                       last_synced_at, include_in_tracking, fidelity_account_number,
                       created_at, updated_at`,
            [
                req.params.id,
                req.user.id,
                name !== undefined ? String(name).trim() : null,
                type ?? null,
                balance !== undefined && balance !== null ? Number(balance) : null,
                notes !== undefined,
                notes !== undefined ? (notes?.trim() || null) : null,
                include_in_tracking !== undefined,
                include_in_tracking ?? null,
            ]
        );

        if (!updated.rowCount) {
            return res.status(404).json({ error: 'Account not found' });
        }

        return res.json(updated.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update account' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await query(
            `DELETE FROM accounts WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id]
        );

        if (!deleted.rowCount) {
            return res.status(404).json({ error: 'Account not found' });
        }

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to delete account' });
    }
});

export default router;
