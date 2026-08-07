import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

const RELATIONSHIPS = ['self', 'spouse', 'partner', 'dependent', 'other'];
const PRESET_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444'];

function formatProfile(row) {
    return {
        id:            row.id,
        name:          row.name,
        relationship:  row.relationship,
        birthYear:     row.birth_year,
        isPrimary:     row.is_primary,
        color:         row.color,
        avatarInitial: row.avatar_initial || row.name?.charAt(0)?.toUpperCase() || '?',
        createdAt:     row.created_at,
        updatedAt:     row.updated_at,
    };
}

// GET /api/profiles — list all profiles for the logged-in user
router.get('/', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, relationship, birth_year, is_primary, color, avatar_initial,
                    created_at, updated_at
             FROM profiles
             WHERE user_id = $1
             ORDER BY is_primary DESC, created_at ASC`,
            [req.user.id]
        );
        return res.json(result.rows.map(formatProfile));
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to load profiles' });
    }
});

// POST /api/profiles — create a new household member profile
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, relationship, birthYear, color } = req.body || {};

        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        if (relationship && !RELATIONSHIPS.includes(relationship)) {
            return res.status(400).json({ error: `relationship must be one of: ${RELATIONSHIPS.join(', ')}` });
        }
        if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
            return res.status(400).json({ error: 'color must be a valid hex color (#rrggbb)' });
        }

        const trimmedName = String(name).trim();
        const initial = trimmedName.charAt(0).toUpperCase();

        const created = await query(
            `INSERT INTO profiles
                 (user_id, name, relationship, birth_year, is_primary, color, avatar_initial)
             VALUES ($1, $2, $3, $4, false, $5, $6)
             RETURNING id, name, relationship, birth_year, is_primary, color, avatar_initial,
                       created_at, updated_at`,
            [
                req.user.id,
                trimmedName,
                RELATIONSHIPS.includes(relationship) ? relationship : 'other',
                birthYear ? Number(birthYear) : null,
                PRESET_COLORS.includes(color) ? color : (color || '#6366f1'),
                initial,
            ]
        );
        return res.status(201).json(formatProfile(created.rows[0]));
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to create profile' });
    }
});

// PUT /api/profiles/:id — update a profile
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { name, relationship, birthYear, color } = req.body || {};

        // Verify ownership
        const existing = await query(
            `SELECT id, is_primary FROM profiles WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!existing.rowCount) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        if (relationship && !RELATIONSHIPS.includes(relationship)) {
            return res.status(400).json({ error: `relationship must be one of: ${RELATIONSHIPS.join(', ')}` });
        }
        if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
            return res.status(400).json({ error: 'color must be a valid hex color (#rrggbb)' });
        }

        const trimmedName = name ? String(name).trim() : null;
        const updated = await query(
            `UPDATE profiles
             SET name           = COALESCE($3, name),
                 relationship   = COALESCE($4, relationship),
                 birth_year     = CASE WHEN $5 THEN $6 ELSE birth_year END,
                 color          = COALESCE($7, color),
                 avatar_initial = COALESCE($8, avatar_initial),
                 updated_at     = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING id, name, relationship, birth_year, is_primary, color, avatar_initial,
                       created_at, updated_at`,
            [
                req.params.id,
                req.user.id,
                trimmedName,
                RELATIONSHIPS.includes(relationship) ? relationship : null,
                birthYear !== undefined,
                birthYear ? Number(birthYear) : null,
                color || null,
                trimmedName ? trimmedName.charAt(0).toUpperCase() : null,
            ]
        );
        return res.json(formatProfile(updated.rows[0]));
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to update profile' });
    }
});

// DELETE /api/profiles/:id — delete a non-primary profile
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const existing = await query(
            `SELECT id, is_primary FROM profiles WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!existing.rowCount) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        if (existing.rows[0].is_primary) {
            return res.status(400).json({ error: 'Cannot delete the primary profile' });
        }

        // Warn if profile has data
        const dataCheck = await query(
            `SELECT
               (SELECT COUNT(*) FROM accounts WHERE profile_id = $1)::int           AS accounts,
               (SELECT COUNT(*) FROM properties WHERE profile_id = $1)::int         AS properties,
               (SELECT COUNT(*) FROM retirement_scenarios WHERE profile_id = $1)::int AS scenarios`,
            [req.params.id]
        );
        const counts = dataCheck.rows[0];
        const totalItems = (counts.accounts || 0) + (counts.properties || 0) + (counts.scenarios || 0);

        // Delete cascades to all child rows via ON DELETE CASCADE
        await query(`DELETE FROM profiles WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);

        return res.json({ success: true, itemsDeleted: totalItems });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to delete profile' });
    }
});

export default router;
