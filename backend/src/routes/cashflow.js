import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { requireProfile, writeProfileId } from '../middleware/profile.js';
import { query } from '../db/client.js';

const router = Router();

// ─── 2026 federal tax brackets ───────────────────────────────────────────────
const BRACKETS = {
    single: [
        [10,  0,       11925],
        [12,  11926,   48475],
        [22,  48476,  103350],
        [24, 103351,  197300],
        [32, 197301,  250525],
        [35, 250526,  626350],
        [37, 626351,  Infinity],
    ],
    married: [
        [10,  0,       23850],
        [12,  23851,   96950],
        [22,  96951,  206700],
        [24, 206701,  394600],
        [32, 394601,  501050],
        [35, 501051,  751600],
        [37, 751601,  Infinity],
    ],
};

const STD_DEDUCTION = { single: 14600, married: 29200 };

const VALID_CATEGORIES = [
    'housing','utilities','insurance','food','transport',
    'healthcare','entertainment','travel','debt','subscriptions','other',
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function calcAnnualTax(annualIncome, status) {
    const deduction    = STD_DEDUCTION[status] ?? STD_DEDUCTION.single;
    const taxable      = Math.max(0, annualIncome - deduction);
    let tax            = 0;
    for (const [rate, lo, hi] of BRACKETS[status]) {
        if (taxable <= lo) break;
        tax += (Math.min(taxable, hi) - lo) * (rate / 100);
    }
    return Math.round(tax * 100) / 100;
}

/**
 * Is this income source active at checkAge?
 * When retirementAge is supplied, ends_at_retirement sources stop at that boundary —
 * so Today view (checkAge=currentAge) includes them unless already retired,
 * and At Retirement view (checkAge=retirementAge) always excludes them.
 */
function isActiveAtAge(src, checkAge, retirementAge = null) {
    // ends_at_retirement: only active during the accumulation phase
    if (src.ends_at_retirement && retirementAge !== null && checkAge >= retirementAge) return false;

    const today = new Date();

    // — start gate —
    if (src.start_type === 'date' && src.start_date) {
        if (new Date(src.start_date) > today) return false;
    } else if (src.start_type === 'age' && src.start_age !== null) {
        if (checkAge < Number(src.start_age)) return false;
    }
    // 'now' → always started

    // — end gate —
    if (src.end_type === 'date' && src.end_date) {
        if (new Date(src.end_date) <= today) return false;
    } else if (src.end_type === 'age' && src.end_age !== null) {
        if (checkAge >= Number(src.end_age)) return false;
    } else if (src.end_type === 'years' && src.end_years !== null) {
        const startAge = src.start_type === 'age' ? Number(src.start_age) : 0;
        if (checkAge >= startAge + Number(src.end_years)) return false;
    }

    return true;
}

function projected(base, src, fromAge, toAge) {
    if (!base) return base;
    const years = Math.max(0, toAge - fromAge);
    if (!src.annual_increase_pct || years === 0) return Number(base);
    return Number(base) * Math.pow(1 + Number(src.annual_increase_pct) / 100, years);
}

// ─── GET /api/cashflow/expenses ──────────────────────────────────────────────
// Returns all active expenses for the active profile:
//   • mortgage payments auto-pulled from properties (source='real_estate')
//   • manual expenses from monthly_expenses

router.get('/expenses', requireAuth, requireProfile, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT
               p.id::text          AS id,
               p.name,
               p.mortgage_payment  AS monthly_amount,
               'housing'           AS category,
               'real_estate'       AS source,
               p.id::text          AS source_id,
               true                AS continues_in_retirement,
               0::numeric          AS retirement_amount,
               true                AS is_active,
               p.mortgage_maturity_date,
               null::text          AS notes
             FROM properties p
             WHERE p.user_id = $1
               AND ($2::int IS NULL OR p.profile_id = $2)
               AND p.mortgage_payment > 0
               AND p.archived_at IS NULL

             UNION ALL

             SELECT
               e.id::text,
               e.name,
               e.monthly_amount,
               e.category,
               e.source,
               e.source_id,
               e.continues_in_retirement,
               COALESCE(e.retirement_amount, e.monthly_amount),
               e.is_active,
               null::date          AS mortgage_maturity_date,
               e.notes
             FROM monthly_expenses e
             WHERE e.user_id = $1
               AND ($2::int IS NULL OR e.profile_id = $2)

             ORDER BY category, name`,
            [req.user.id, req.profileId],
        );
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to load expenses' });
    }
});

// ─── POST /api/cashflow/expenses ─────────────────────────────────────────────

router.post('/expenses', requireAuth, requireProfile, async (req, res) => {
    try {
        const { name, category, monthly_amount,
                continues_in_retirement, retirement_amount, notes } = req.body || {};

        if (!name?.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        if (!Number.isFinite(Number(monthly_amount)) || Number(monthly_amount) < 0) {
            return res.status(400).json({ error: 'monthly_amount must be a non-negative number' });
        }

        const cat         = VALID_CATEGORIES.includes(category) ? category : 'other';
        const retireAmt   = retirement_amount !== undefined && retirement_amount !== ''
            ? Number(retirement_amount) : null;

        const { rows } = await query(
            `INSERT INTO monthly_expenses
               (user_id, profile_id, name, category, monthly_amount,
                continues_in_retirement, retirement_amount, source, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8)
             RETURNING *`,
            [
                req.user.id, writeProfileId(req),
                name.trim(), cat, Number(monthly_amount),
                continues_in_retirement !== false,
                retireAmt,
                notes?.trim() || null,
            ],
        );
        return res.status(201).json(rows[0]);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to create expense' });
    }
});

// ─── PUT /api/cashflow/expenses/:id ──────────────────────────────────────────

router.put('/expenses/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const existing = await query(
            `SELECT id, source FROM monthly_expenses WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id],
        );
        if (!existing.rowCount) {
            return res.status(404).json({ error: 'Expense not found' });
        }
        if (existing.rows[0].source === 'real_estate') {
            return res.status(400).json({ error: 'Edit mortgage expenses via the Real Estate page' });
        }

        const { name, category, monthly_amount,
                continues_in_retirement, retirement_amount, notes } = req.body || {};

        if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

        const cat       = VALID_CATEGORIES.includes(category) ? category : 'other';
        const retireAmt = retirement_amount !== undefined && retirement_amount !== ''
            ? Number(retirement_amount) : null;

        const { rows } = await query(
            `UPDATE monthly_expenses SET
               name = $3, category = $4, monthly_amount = $5,
               continues_in_retirement = $6, retirement_amount = $7,
               notes = $8, updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [
                req.params.id, req.user.id,
                name.trim(), cat, Number(monthly_amount) || 0,
                continues_in_retirement !== false,
                retireAmt,
                notes?.trim() || null,
            ],
        );
        return res.json(rows[0]);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to update expense' });
    }
});

// ─── PATCH /api/cashflow/expenses/:id/toggle ─────────────────────────────────

router.patch('/expenses/:id/toggle', requireAuth, requireProfile, async (req, res) => {
    try {
        const { included } = req.body ?? {};
        if (typeof included !== 'boolean') {
            return res.status(400).json({ error: 'included must be a boolean' });
        }
        const existing = await query(
            `SELECT id, source FROM monthly_expenses WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id],
        );
        if (!existing.rowCount) return res.status(404).json({ error: 'Expense not found' });
        if (existing.rows[0].source === 'real_estate') {
            return res.status(400).json({ error: 'Toggle RE mortgage expenses via the Real Estate page' });
        }
        const { rows } = await query(
            `UPDATE monthly_expenses SET is_active = $3, updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [req.params.id, req.user.id, included],
        );
        return res.json(rows[0]);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to toggle expense' });
    }
});

// ─── DELETE /api/cashflow/expenses/:id ───────────────────────────────────────

router.delete('/expenses/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const existing = await query(
            `SELECT id, source FROM monthly_expenses WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id],
        );
        if (!existing.rowCount) return res.status(404).json({ error: 'Expense not found' });
        if (existing.rows[0].source === 'real_estate') {
            return res.status(400).json({ error: 'Mortgage expenses are managed via Real Estate' });
        }

        await query(
            `DELETE FROM monthly_expenses WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id],
        );
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to delete expense' });
    }
});

// ─── GET /api/cashflow/summary ───────────────────────────────────────────────
// Returns the complete cash flow picture for today and at retirement.
// Query param: filingStatus = 'single' (default) | 'married'

router.get('/summary', requireAuth, requireProfile, async (req, res) => {
    try {
        const filingStatus = req.query.filingStatus === 'married' ? 'married' : 'single';

        // Age data from active retirement scenario
        const { rows: scenarios } = await query(
            `SELECT current_age, retirement_age
             FROM retirement_scenarios
             WHERE user_id = $1 AND is_active = true
               AND ($2::int IS NULL OR profile_id = $2)
             ORDER BY updated_at DESC LIMIT 1`,
            [req.user.id, req.profileId],
        );
        const currentAge    = Number(scenarios[0]?.current_age)    || 62;
        const retirementAge = Number(scenarios[0]?.retirement_age) || 67;

        // All active recurring income sources
        const { rows: incomeSources } = await query(
            `SELECT * FROM recurring_income
             WHERE user_id = $1
               AND ($2::int IS NULL OR profile_id = $2)
               AND is_active = true
             ORDER BY income_type, name`,
            [req.user.id, req.profileId],
        );

        // All active expenses (mortgage + manual)
        const { rows: allExpenses } = await query(
            `SELECT
               p.id::text          AS id,
               p.name,
               p.mortgage_payment  AS monthly_amount,
               'housing'           AS category,
               'real_estate'       AS source,
               true                AS continues_in_retirement,
               0::numeric          AS retirement_amount
             FROM properties p
             WHERE p.user_id = $1
               AND ($2::int IS NULL OR p.profile_id = $2)
               AND p.mortgage_payment > 0
               AND p.archived_at IS NULL

             UNION ALL

             SELECT
               e.id::text, e.name, e.monthly_amount, e.category,
               e.source, e.continues_in_retirement,
               COALESCE(e.retirement_amount, e.monthly_amount)
             FROM monthly_expenses e
             WHERE e.user_id = $1
               AND ($2::int IS NULL OR e.profile_id = $2)
               AND e.is_active = true`,
            [req.user.id, req.profileId],
        );

        // ── TODAY ─────────────────────────────────────────────────────────────

        const todaySources = [];
        let todayGross = 0;
        let todayNet   = 0;

        for (const src of incomeSources) {
            if (!isActiveAtAge(src, currentAge, retirementAge)) continue;
            const net   = Number(src.monthly_amount) || 0;
            const gross = src.gross_monthly_amount ? Number(src.gross_monthly_amount) : null;
            todaySources.push({ name: src.name, type: src.income_type, gross, net });
            todayNet   += net;
            todayGross += gross ?? net;
        }

        const todayExpTotal = allExpenses.reduce((s, e) => s + Number(e.monthly_amount), 0);
        const todayByCategory = {};
        for (const e of allExpenses) {
            todayByCategory[e.category] = (todayByCategory[e.category] || 0) + Number(e.monthly_amount);
        }
        const todayDisposable  = todayNet - todayExpTotal;
        const todaySavingsRate = todayNet > 0
            ? Math.round((todayDisposable / todayNet) * 1000) / 10 : 0;

        // ── AT RETIREMENT ─────────────────────────────────────────────────────

        const retireSources = [];
        let retireGross   = 0;
        let retireNetPre  = 0;   // before estimated tax
        let retireTaxable = 0;

        for (const src of incomeSources) {
            if (!isActiveAtAge(src, retirementAge, retirementAge)) continue;
            const fromAge = src.start_type === 'age' ? (Number(src.start_age) || currentAge) : currentAge;
            const net     = Math.round(projected(src.monthly_amount,       src, fromAge, retirementAge) * 100) / 100;
            const grossRaw = src.gross_monthly_amount
                ? Math.round(projected(src.gross_monthly_amount, src, fromAge, retirementAge) * 100) / 100
                : null;

            retireSources.push({ name: src.name, type: src.income_type, gross: grossRaw, net });
            retireNetPre  += net;
            retireGross   += grossRaw ?? net;
            if (src.tax_treatment === 'taxable') retireTaxable += net;
        }

        // Simple tax estimate on taxable retirement income
        const annualTax        = calcAnnualTax(retireTaxable * 12, filingStatus);
        const monthlyTax       = Math.round(annualTax / 12 * 100) / 100;
        const effectiveRate    = retireTaxable > 0
            ? Math.round((annualTax / (retireTaxable * 12)) * 1000) / 10 : 0;
        const retireNet        = Math.max(0, retireNetPre - monthlyTax);

        // Expenses at retirement — only continuing items
        const retireExpItems = allExpenses
            .filter((e) => e.continues_in_retirement)
            .map((e) => ({ ...e, monthly_amount: Number(e.retirement_amount ?? e.monthly_amount) }));

        const retireExpTotal = retireExpItems.reduce((s, e) => s + e.monthly_amount, 0);
        const retireByCategory = {};
        for (const e of retireExpItems) {
            retireByCategory[e.category] = (retireByCategory[e.category] || 0) + e.monthly_amount;
        }

        return res.json({
            today: {
                income: {
                    gross:   Math.round(todayGross * 100) / 100,
                    net:     Math.round(todayNet   * 100) / 100,
                    sources: todaySources,
                },
                expenses: {
                    total:      Math.round(todayExpTotal   * 100) / 100,
                    byCategory: todayByCategory,
                    items:      allExpenses,
                },
                disposable:  Math.round(todayDisposable  * 100) / 100,
                savingsRate: todaySavingsRate,
            },
            atRetirement: {
                income: {
                    gross:        Math.round(retireGross  * 100) / 100,
                    netPreTax:    Math.round(retireNetPre * 100) / 100,
                    estimatedTax: monthlyTax,
                    net:          Math.round(retireNet    * 100) / 100,
                    sources:      retireSources,
                },
                expenses: {
                    total:      Math.round(retireExpTotal * 100) / 100,
                    byCategory: retireByCategory,
                    items:      retireExpItems,
                },
                disposable:   Math.round((retireNet - retireExpTotal) * 100) / 100,
                currentAge,
                retirementAge,
            },
            taxEstimate: {
                filingStatus,
                taxableMonthlyIncome:  Math.round(retireTaxable * 100) / 100,
                estimatedAnnualTax:    annualTax,
                estimatedMonthlyTax:   monthlyTax,
                effectiveRate,
                standardDeduction:     STD_DEDUCTION[filingStatus],
                note: 'Rough estimate only. Consult a tax professional.',
            },
        });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to load cash flow summary' });
    }
});

export default router;
