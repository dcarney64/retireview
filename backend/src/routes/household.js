import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

const MEMBER_COLUMNS = `
    id, name, relationship, birth_year, current_age, employment_status,
    monthly_income, social_security_monthly, social_security_age,
    pension_monthly, retirement_age, estimated_assets, estimated_liabilities,
    include_in_combined, notes, created_at, updated_at`;

const RELATIONSHIPS = ['spouse', 'partner', 'dependent', 'other'];
const EMPLOYMENT_STATUSES = ['employed', 'self_employed', 'retired', 'other'];

// GET /api/household — list members
router.get('/', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT ${MEMBER_COLUMNS}
             FROM household_members
             WHERE user_id = $1
             ORDER BY created_at`,
            [req.user.id]
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load household members' });
    }
});

// GET /api/household/summary — combined household financials
router.get('/summary', requireAuth, async (req, res) => {
    try {
        const [membersResult, propertiesResult, accountsResult] = await Promise.all([
            query(
                `SELECT ${MEMBER_COLUMNS}
                 FROM household_members
                 WHERE user_id = $1
                 ORDER BY created_at`,
                [req.user.id]
            ),
            query(
                `SELECT estimated_value, mortgage_balance, ownership_pct
                 FROM properties
                 WHERE user_id = $1 AND archived_at IS NULL`,
                [req.user.id]
            ),
            query(
                `SELECT COALESCE(SUM(balance), 0) AS total
                 FROM accounts
                 WHERE user_id = $1 AND include_in_tracking = true AND archived_at IS NULL`,
                [req.user.id]
            ),
        ]);

        const members = membersResult.rows;
        const combined = members.filter((m) => m.include_in_combined);

        // User's liquid assets (from accounts)
        const userLiquid = Number(accountsResult.rows[0]?.total || 0);

        // User's RE equity (ownership share)
        const userReEquity = propertiesResult.rows.reduce((s, p) => {
            const pct = Number(p.ownership_pct ?? 100) / 100;
            const val = Number(p.estimated_value) * pct;
            const mort = (Number(p.mortgage_balance) || 0) * pct;
            return s + (val - mort);
        }, 0);

        const totalMonthlyIncome = combined.reduce((s, m) => s + Number(m.monthly_income), 0);
        const memberAssets = combined.reduce((s, m) => s + Number(m.estimated_assets), 0);
        const memberLiabilities = combined.reduce((s, m) => s + Number(m.estimated_liabilities), 0);

        const retirementIncome = {};
        const totalSS = combined.reduce((s, m) => {
            retirementIncome[m.name + 'SS'] = Number(m.social_security_monthly);
            return s + Number(m.social_security_monthly);
        }, 0);
        const totalPension = combined.reduce((s, m) => {
            retirementIncome[m.name + 'Pension'] = Number(m.pension_monthly);
            return s + Number(m.pension_monthly);
        }, 0);

        return res.json({
            members,
            combined: {
                totalMonthlyIncome,
                memberAssets,
                memberLiabilities,
                memberNetWorth: memberAssets - memberLiabilities,
                retirementIncome: {
                    members: combined.map((m) => ({
                        name: m.name,
                        ss: Number(m.social_security_monthly),
                        ssAge: m.social_security_age,
                        pension: Number(m.pension_monthly),
                    })),
                    totalSSMonthly: totalSS,
                    totalPensionMonthly: totalPension,
                    totalMonthly: totalSS + totalPension,
                },
            },
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load household summary' });
    }
});

// POST /api/household — add member
router.post('/', requireAuth, async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.name || !String(body.name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        const created = await query(
            `INSERT INTO household_members
                 (user_id, name, relationship, birth_year, current_age,
                  employment_status, monthly_income, social_security_monthly,
                  social_security_age, pension_monthly, retirement_age,
                  estimated_assets, estimated_liabilities,
                  include_in_combined, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING ${MEMBER_COLUMNS}`,
            [
                req.user.id,
                String(body.name).trim(),
                RELATIONSHIPS.includes(body.relationship) ? body.relationship : 'spouse',
                body.birth_year != null && body.birth_year !== '' ? Number(body.birth_year) : null,
                body.current_age != null && body.current_age !== '' ? Number(body.current_age) : null,
                EMPLOYMENT_STATUSES.includes(body.employment_status) ? body.employment_status : 'employed',
                Number(body.monthly_income) || 0,
                Number(body.social_security_monthly) || 0,
                Number(body.social_security_age) || 67,
                Number(body.pension_monthly) || 0,
                Number(body.retirement_age) || 67,
                Number(body.estimated_assets) || 0,
                Number(body.estimated_liabilities) || 0,
                body.include_in_combined !== false,
                body.notes?.trim() || null,
            ]
        );
        return res.status(201).json(created.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to add household member' });
    }
});

// PUT /api/household/:id — update member
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const body = req.body || {};
        const existing = await query(
            `SELECT id FROM household_members WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!existing.rowCount) {
            return res.status(404).json({ error: 'Household member not found' });
        }

        const updated = await query(
            `UPDATE household_members SET
                name                    = COALESCE($3, name),
                relationship            = COALESCE($4, relationship),
                birth_year              = CASE WHEN $5 THEN $6 ELSE birth_year END,
                current_age             = CASE WHEN $7 THEN $8 ELSE current_age END,
                employment_status       = COALESCE($9, employment_status),
                monthly_income          = COALESCE($10, monthly_income),
                social_security_monthly = COALESCE($11, social_security_monthly),
                social_security_age     = COALESCE($12, social_security_age),
                pension_monthly         = COALESCE($13, pension_monthly),
                retirement_age          = COALESCE($14, retirement_age),
                estimated_assets        = COALESCE($15, estimated_assets),
                estimated_liabilities   = COALESCE($16, estimated_liabilities),
                include_in_combined     = COALESCE($17, include_in_combined),
                notes                   = CASE WHEN $18 THEN $19 ELSE notes END,
                updated_at              = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING ${MEMBER_COLUMNS}`,
            [
                req.params.id,
                req.user.id,
                body.name !== undefined ? String(body.name).trim() : null,
                body.relationship !== undefined && RELATIONSHIPS.includes(body.relationship) ? body.relationship : null,
                body.birth_year !== undefined,
                body.birth_year != null && body.birth_year !== '' ? Number(body.birth_year) : null,
                body.current_age !== undefined,
                body.current_age != null && body.current_age !== '' ? Number(body.current_age) : null,
                body.employment_status !== undefined && EMPLOYMENT_STATUSES.includes(body.employment_status) ? body.employment_status : null,
                body.monthly_income !== undefined ? Number(body.monthly_income) || 0 : null,
                body.social_security_monthly !== undefined ? Number(body.social_security_monthly) || 0 : null,
                body.social_security_age !== undefined ? Number(body.social_security_age) || 67 : null,
                body.pension_monthly !== undefined ? Number(body.pension_monthly) || 0 : null,
                body.retirement_age !== undefined ? Number(body.retirement_age) || 67 : null,
                body.estimated_assets !== undefined ? Number(body.estimated_assets) || 0 : null,
                body.estimated_liabilities !== undefined ? Number(body.estimated_liabilities) || 0 : null,
                typeof body.include_in_combined === 'boolean' ? body.include_in_combined : null,
                body.notes !== undefined,
                body.notes !== undefined ? (body.notes?.trim() || null) : null,
            ]
        );
        return res.json(updated.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update household member' });
    }
});

// DELETE /api/household/:id — remove member
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await query(
            `DELETE FROM household_members WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id]
        );
        if (!deleted.rowCount) {
            return res.status(404).json({ error: 'Household member not found' });
        }
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to remove household member' });
    }
});

export default router;
