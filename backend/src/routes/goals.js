import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, target_amount, target_annual_income, retirement_years,
                    expected_return, ss_monthly, target_date, created_at
             FROM goals
             WHERE user_id = $1
             LIMIT 1`,
            [req.user.id]
        );
        return res.json(result.rows[0] || null);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load goal' });
    }
});

// Upsert — one goal per user
router.post('/', requireAuth, async (req, res) => {
    try {
        const {
            targetAmount,
            targetAnnualIncome,
            retirementYears,
            expectedReturn,
            ssMonthly,
            targetDate,
        } = req.body || {};

        if (!Number.isFinite(Number(targetAmount)) || Number(targetAmount) <= 0) {
            return res.status(400).json({ error: 'targetAmount must be a positive number' });
        }

        const saved = await query(
            `INSERT INTO goals (user_id, target_amount, target_annual_income,
                                retirement_years, expected_return, ss_monthly, target_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id)
             DO UPDATE SET
                 target_amount = EXCLUDED.target_amount,
                 target_annual_income = EXCLUDED.target_annual_income,
                 retirement_years = EXCLUDED.retirement_years,
                 expected_return = EXCLUDED.expected_return,
                 ss_monthly = EXCLUDED.ss_monthly,
                 target_date = EXCLUDED.target_date
             RETURNING id, target_amount, target_annual_income, retirement_years,
                       expected_return, ss_monthly, target_date, created_at`,
            [
                req.user.id,
                Number(targetAmount),
                Number.isFinite(Number(targetAnnualIncome)) ? Number(targetAnnualIncome) : null,
                Number.isInteger(Number(retirementYears)) ? Number(retirementYears) : null,
                Number.isFinite(Number(expectedReturn)) ? Number(expectedReturn) : null,
                Number.isFinite(Number(ssMonthly)) ? Number(ssMonthly) : null,
                targetDate || null,
            ]
        );
        return res.json(saved.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to save goal' });
    }
});

export default router;
