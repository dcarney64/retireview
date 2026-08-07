import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { requireProfile, writeProfileId } from '../middleware/profile.js';
import { query } from '../db/client.js';

const router = Router();

const INCOME_TYPES  = ['social_security','pension','annuity','rental','employment','other'];
const START_TYPES   = ['now','age','date'];
const END_TYPES     = ['lifetime','age','date','years'];
const TAX_TYPES     = ['taxable','tax_deferred','tax_free'];

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the age at which this source starts paying.
 * Returns null when the source uses date-based logic only.
 */
function resolveStartAge(src) {
    if (src.start_type === 'now')  return 0;   // already active
    if (src.start_type === 'age')  return Number(src.start_age) || null;
    // 'date' — caller must compare against today separately
    return null;
}

/**
 * Resolve the age at which this source stops.
 * Returns null when it is lifetime / indeterminate.
 */
function resolveEndAge(src, startAge) {
    if (src.end_type === 'lifetime') return null;
    if (src.end_type === 'age')      return Number(src.end_age)  || null;
    if (src.end_type === 'date')     return null; // caller handles date
    if (src.end_type === 'years') {
        const sa = startAge ?? 0;
        return src.end_years ? sa + Number(src.end_years) : null;
    }
    return null;
}

/**
 * Is this source active at the given reference age?
 * Also respects date-based start/end relative to today.
 */
function isActiveAtAge(src, checkAge) {
    const today = new Date();

    // — start check —
    if (src.start_type === 'date' && src.start_date) {
        if (new Date(src.start_date) > today) return false; // hasn't started yet by date
    } else {
        const startAge = resolveStartAge(src);
        if (startAge !== null && checkAge < startAge) return false;
    }

    // — end check —
    const startAge = resolveStartAge(src);
    const endAge   = resolveEndAge(src, startAge);

    if (src.end_type === 'date' && src.end_date) {
        if (new Date(src.end_date) <= today) return false;
    } else if (endAge !== null && checkAge >= endAge) {
        return false;
    }

    return true;
}

/**
 * Monthly amount projected to a future age, accounting for annual_increase_pct.
 */
function projectedAmount(src, fromAge, toAge) {
    const base  = Number(src.monthly_amount) || 0;
    const years = Math.max(0, toAge - fromAge);
    if (!src.annual_increase_pct || years === 0) return base;
    return base * Math.pow(1 + Number(src.annual_increase_pct) / 100, years);
}

function addComputed(src, currentAge, retirementAge) {
    const activeNow        = src.is_active && isActiveAtAge(src, currentAge);
    const activeAtRetire   = src.is_active && isActiveAtAge(src, retirementAge);
    const startAge         = resolveStartAge(src);
    const endAge           = resolveEndAge(src, startAge);
    const incomeStartAge   = startAge ?? currentAge;
    const monthly          = projectedAmount(src, incomeStartAge, retirementAge);

    // Lifetime total — only if end_age is set
    let lifetimeTotal = null;
    if (endAge !== null) {
        const lifeExpect = 90;
        const stopAge    = Math.min(endAge, lifeExpect);
        const startPay   = Math.max(retirementAge, incomeStartAge);
        const years      = Math.max(0, stopAge - startPay);
        lifetimeTotal    = Math.round(monthly * 12 * years * 100) / 100;
    }

    return {
        ...src,
        monthly_amount:    Number(src.monthly_amount),
        annual_increase_pct: Number(src.annual_increase_pct),
        isCurrentlyActive: activeNow,
        monthlyAtRetirement: activeAtRetire ? Math.round(monthly * 100) / 100 : 0,
        annualAmount:      Math.round(Number(src.monthly_amount) * 12 * 100) / 100,
        lifetimeTotal,
        resolvedStartAge:  startAge,
        resolvedEndAge:    endAge,
    };
}

// ─── GET /api/recurring-income ────────────────────────────────────────────────

router.get('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const { rows: sources } = await query(
            `SELECT * FROM recurring_income
             WHERE user_id = $1
               AND ($2::int IS NULL OR profile_id = $2)
             ORDER BY is_active DESC, COALESCE(start_age, 0) ASC, created_at ASC`,
            [req.user.id, req.profileId],
        );

        // Get current_age from active scenario (fall back to 62)
        const { rows: scenarios } = await query(
            `SELECT current_age, retirement_age
             FROM retirement_scenarios
             WHERE user_id = $1 AND is_active = true
               AND ($2::int IS NULL OR profile_id = $2)
             ORDER BY updated_at DESC
             LIMIT 1`,
            [req.user.id, req.profileId],
        );
        const currentAge    = Number(scenarios[0]?.current_age)    || 62;
        const retirementAge = Number(scenarios[0]?.retirement_age) || 67;

        return res.json(sources.map((s) => addComputed(s, currentAge, retirementAge)));
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to load recurring income' });
    }
});

// ─── GET /api/recurring-income/summary ───────────────────────────────────────

router.get('/summary', requireAuth, requireProfile, async (req, res) => {
    try {
        const { rows: sources } = await query(
            `SELECT * FROM recurring_income
             WHERE user_id = $1
               AND ($2::int IS NULL OR profile_id = $2)
               AND is_active = true`,
            [req.user.id, req.profileId],
        );

        const { rows: scenarios } = await query(
            `SELECT current_age, retirement_age
             FROM retirement_scenarios
             WHERE user_id = $1 AND is_active = true
               AND ($2::int IS NULL OR profile_id = $2)
             ORDER BY updated_at DESC
             LIMIT 1`,
            [req.user.id, req.profileId],
        );
        const currentAge    = Number(scenarios[0]?.current_age)    || 62;
        const retirementAge = Number(scenarios[0]?.retirement_age) || 67;

        let currentMonthly    = 0;
        let retirementMonthly = 0;
        const breakdown        = [];
        const byType           = {};
        let totalTaxable   = 0;
        let totalTaxFree   = 0;

        for (const s of sources) {
            const computed    = addComputed(s, currentAge, retirementAge);
            const startAge    = computed.resolvedStartAge;
            const endAge      = computed.resolvedEndAge;

            if (computed.isCurrentlyActive) {
                currentMonthly += Number(s.monthly_amount);
            }

            retirementMonthly += computed.monthlyAtRetirement;

            const note =
                computed.monthlyAtRetirement === 0
                    ? (endAge !== null && endAge <= retirementAge)
                        ? 'ends before retirement'
                        : 'not yet started at retirement'
                    : null;

            breakdown.push({
                id:           s.id,
                name:         s.name,
                type:         s.income_type,
                monthly:      computed.monthlyAtRetirement,
                taxTreatment: s.tax_treatment,
                ...(note ? { note } : {}),
            });

            byType[s.income_type] = (byType[s.income_type] || 0) + computed.monthlyAtRetirement;

            if (s.tax_treatment === 'taxable')      totalTaxable += computed.monthlyAtRetirement;
            if (s.tax_treatment === 'tax_free')     totalTaxFree  += computed.monthlyAtRetirement;
        }

        // Ensure all types present in byType
        for (const t of INCOME_TYPES) {
            if (!(t in byType)) byType[t] = 0;
        }

        return res.json({
            currentMonthly:   Math.round(currentMonthly * 100) / 100,
            atRetirement: {
                monthly:  Math.round(retirementMonthly * 100) / 100,
                annual:   Math.round(retirementMonthly * 12 * 100) / 100,
                breakdown,
            },
            byType,
            totalTaxable:     Math.round(totalTaxable * 100) / 100,
            totalTaxFree:     Math.round(totalTaxFree * 100) / 100,
            currentAge,
            retirementAge,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to load income summary' });
    }
});

// ─── POST /api/recurring-income ──────────────────────────────────────────────

router.post('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const body = req.body || {};
        const {
            name, income_type, monthly_amount,
            start_type, start_age, start_date,
            end_type, end_age, end_date, end_years,
            is_inflation_adjusted, annual_increase_pct,
            tax_treatment, notes,
        } = body;

        if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
        if (!INCOME_TYPES.includes(income_type)) {
            return res.status(400).json({ error: `income_type must be one of: ${INCOME_TYPES.join(', ')}` });
        }
        if (!Number.isFinite(Number(monthly_amount)) || Number(monthly_amount) < 0) {
            return res.status(400).json({ error: 'monthly_amount must be a non-negative number' });
        }

        const effectiveStartType = START_TYPES.includes(start_type) ? start_type : 'age';
        const effectiveEndType   = END_TYPES.includes(end_type)     ? end_type   : 'lifetime';
        const effectiveTax       = TAX_TYPES.includes(tax_treatment) ? tax_treatment : 'taxable';

        const { rows } = await query(
            `INSERT INTO recurring_income
                (user_id, profile_id, name, income_type, monthly_amount,
                 start_type, start_age, start_date,
                 end_type, end_age, end_date, end_years,
                 is_inflation_adjusted, annual_increase_pct,
                 tax_treatment, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING *`,
            [
                req.user.id, writeProfileId(req),
                name.trim(), income_type, Number(monthly_amount),
                effectiveStartType, start_age || null, start_date || null,
                effectiveEndType, end_age || null, end_date || null, end_years || null,
                Boolean(is_inflation_adjusted), Number(annual_increase_pct) || 0,
                effectiveTax, notes?.trim() || null,
            ],
        );
        return res.status(201).json(rows[0]);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to create income source' });
    }
});

// ─── PUT /api/recurring-income/:id ───────────────────────────────────────────

router.put('/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const body = req.body || {};
        const {
            name, income_type, monthly_amount,
            start_type, start_age, start_date,
            end_type, end_age, end_date, end_years,
            is_inflation_adjusted, annual_increase_pct,
            tax_treatment, is_active, notes,
        } = body;

        // Verify ownership
        const existing = await query(
            `SELECT id FROM recurring_income WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id],
        );
        if (!existing.rowCount) return res.status(404).json({ error: 'Income source not found' });

        if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
        if (!INCOME_TYPES.includes(income_type)) {
            return res.status(400).json({ error: `income_type must be one of: ${INCOME_TYPES.join(', ')}` });
        }

        const effectiveStartType = START_TYPES.includes(start_type) ? start_type : 'age';
        const effectiveEndType   = END_TYPES.includes(end_type)     ? end_type   : 'lifetime';
        const effectiveTax       = TAX_TYPES.includes(tax_treatment) ? tax_treatment : 'taxable';

        const { rows } = await query(
            `UPDATE recurring_income SET
                name = $3, income_type = $4, monthly_amount = $5,
                start_type = $6, start_age = $7, start_date = $8,
                end_type = $9, end_age = $10, end_date = $11, end_years = $12,
                is_inflation_adjusted = $13, annual_increase_pct = $14,
                tax_treatment = $15, is_active = $16, notes = $17,
                updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [
                req.params.id, req.user.id,
                name.trim(), income_type, Number(monthly_amount) || 0,
                effectiveStartType, start_age || null, start_date || null,
                effectiveEndType, end_age || null, end_date || null, end_years || null,
                Boolean(is_inflation_adjusted), Number(annual_increase_pct) || 0,
                effectiveTax, is_active !== false, notes?.trim() || null,
            ],
        );
        return res.json(rows[0]);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to update income source' });
    }
});

// ─── DELETE /api/recurring-income/:id ────────────────────────────────────────

router.delete('/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const deleted = await query(
            `DELETE FROM recurring_income WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id],
        );
        if (!deleted.rowCount) return res.status(404).json({ error: 'Income source not found' });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to delete income source' });
    }
});

export default router;
