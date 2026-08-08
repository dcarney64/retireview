import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { requireProfile, writeProfileId } from '../middleware/profile.js';
import { query } from '../db/client.js';

const router = Router();

const ASSET_COLUMNS = `
    id, name, asset_type, description, estimated_value, ownership_pct,
    generates_income, monthly_income, income_description,
    expected_sale_age, expected_sale_value, notes,
    include_in_calculations, archived_at, created_at, updated_at`;

const ASSET_TYPES = ['business', 'intellectual_property', 'vehicle', 'collectible', 'equipment', 'other'];

function withComputed(row) {
    const ownershipPct = Number(row.ownership_pct ?? 100) / 100;
    const yourShare = Number(row.estimated_value) * ownershipPct;
    return {
        ...row,
        yourShare: Math.round(yourShare * 100) / 100,
        annualIncome: Number(row.monthly_income) * 12,
    };
}

// GET /api/other-assets/summary
router.get('/summary', requireAuth, requireProfile, async (req, res) => {
    try {
        const result = await query(
            `SELECT ${ASSET_COLUMNS}
             FROM other_assets
             WHERE user_id = $1 AND archived_at IS NULL
               AND ($2::int IS NULL OR profile_id = $2)
             ORDER BY created_at`,
            [req.user.id, req.profileId]
        );
        const assets = result.rows.map(withComputed);
        const included = assets.filter((a) => a.include_in_calculations !== false);
        const totalValue = included.reduce((s, a) => s + Number(a.estimated_value), 0);
        const yourShare = included.reduce((s, a) => s + a.yourShare, 0);
        const monthlyIncome = included
            .filter((a) => a.generates_income)
            .reduce((s, a) => s + Number(a.monthly_income), 0);

        return res.json({
            totalValue,
            yourShare,
            monthlyIncome,
            annualIncome: monthlyIncome * 12,
            assets,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load other assets summary' });
    }
});

// GET /api/other-assets — list assets
router.get('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const result = await query(
            `SELECT ${ASSET_COLUMNS}
             FROM other_assets
             WHERE user_id = $1
               AND ($2::int IS NULL OR profile_id = $2)
             ORDER BY archived_at NULLS FIRST, created_at`,
            [req.user.id, req.profileId]
        );
        return res.json(result.rows.map(withComputed));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load other assets' });
    }
});

// POST /api/other-assets — create
router.post('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.name || !String(body.name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        if (!Number.isFinite(Number(body.estimated_value)) || Number(body.estimated_value) < 0) {
            return res.status(400).json({ error: 'estimated_value must be a non-negative number' });
        }

        const created = await query(
            `INSERT INTO other_assets
                 (user_id, profile_id, name, asset_type, description, estimated_value,
                  ownership_pct, generates_income, monthly_income, income_description,
                  expected_sale_age, expected_sale_value, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING ${ASSET_COLUMNS}`,
            [
                req.user.id,
                writeProfileId(req),
                String(body.name).trim(),
                ASSET_TYPES.includes(body.asset_type) ? body.asset_type : 'business',
                body.description?.trim() || null,
                Number(body.estimated_value) || 0,
                body.ownership_pct != null && body.ownership_pct !== '' ? Number(body.ownership_pct) : 100,
                body.generates_income === true,
                Number(body.monthly_income) || 0,
                body.income_description?.trim() || null,
                body.expected_sale_age != null && body.expected_sale_age !== '' ? Number(body.expected_sale_age) : null,
                body.expected_sale_value != null && body.expected_sale_value !== '' ? Number(body.expected_sale_value) : null,
                body.notes?.trim() || null,
            ]
        );
        return res.status(201).json(withComputed(created.rows[0]));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to create other asset' });
    }
});

// PUT /api/other-assets/:id — update
router.put('/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const body = req.body || {};
        const existing = await query(
            `SELECT id FROM other_assets WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!existing.rowCount) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const updated = await query(
            `UPDATE other_assets SET
                name                = COALESCE($3, name),
                asset_type          = COALESCE($4, asset_type),
                description         = CASE WHEN $5 THEN $6 ELSE description END,
                estimated_value     = COALESCE($7, estimated_value),
                ownership_pct       = COALESCE($8, ownership_pct),
                generates_income    = COALESCE($9, generates_income),
                monthly_income      = COALESCE($10, monthly_income),
                income_description  = CASE WHEN $11 THEN $12 ELSE income_description END,
                expected_sale_age   = CASE WHEN $13 THEN $14 ELSE expected_sale_age END,
                expected_sale_value = CASE WHEN $15 THEN $16 ELSE expected_sale_value END,
                notes               = CASE WHEN $17 THEN $18 ELSE notes END,
                updated_at          = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING ${ASSET_COLUMNS}`,
            [
                req.params.id,
                req.user.id,
                body.name !== undefined ? String(body.name).trim() : null,
                body.asset_type !== undefined && ASSET_TYPES.includes(body.asset_type) ? body.asset_type : null,
                body.description !== undefined,
                body.description !== undefined ? (body.description?.trim() || null) : null,
                body.estimated_value !== undefined ? Number(body.estimated_value) : null,
                body.ownership_pct !== undefined ? Number(body.ownership_pct) : null,
                typeof body.generates_income === 'boolean' ? body.generates_income : null,
                body.monthly_income !== undefined ? Number(body.monthly_income) || 0 : null,
                body.income_description !== undefined,
                body.income_description !== undefined ? (body.income_description?.trim() || null) : null,
                body.expected_sale_age !== undefined,
                body.expected_sale_age != null && body.expected_sale_age !== '' ? Number(body.expected_sale_age) : null,
                body.expected_sale_value !== undefined,
                body.expected_sale_value != null && body.expected_sale_value !== '' ? Number(body.expected_sale_value) : null,
                body.notes !== undefined,
                body.notes !== undefined ? (body.notes?.trim() || null) : null,
            ]
        );
        return res.json(withComputed(updated.rows[0]));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update other asset' });
    }
});

// PATCH /api/other-assets/:id/toggle — flip include_in_calculations
router.patch('/:id/toggle', requireAuth, requireProfile, async (req, res) => {
    try {
        const { included } = req.body ?? {};
        if (typeof included !== 'boolean') {
            return res.status(400).json({ error: 'included must be a boolean' });
        }
        const updated = await query(
            `UPDATE other_assets
             SET include_in_calculations = $3, updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING ${ASSET_COLUMNS}`,
            [req.params.id, req.user.id, included]
        );
        if (!updated.rowCount) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        return res.json(withComputed(updated.rows[0]));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update asset' });
    }
});

// DELETE /api/other-assets/:id — soft delete (archive)
router.delete('/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const archived = await query(
            `UPDATE other_assets SET archived_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
             RETURNING id`,
            [req.params.id, req.user.id]
        );
        if (!archived.rowCount) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to archive other asset' });
    }
});

export default router;
