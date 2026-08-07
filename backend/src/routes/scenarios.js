import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

const WITHDRAWAL_TYPES = ['percentage', 'fixed', 'income_gap'];

const SCENARIO_COLUMNS = `
    id, name, is_active, color, current_age, retirement_age, life_expectancy,
    starting_portfolio, include_real_estate, real_estate_value,
    pre_retirement_return, post_retirement_return, inflation_rate,
    social_security_monthly, social_security_start_age, pension_monthly,
    rental_income_monthly, other_income_monthly,
    withdrawal_rate, withdrawal_type, fixed_withdrawal_amount,
    annual_spending_goal, created_at, updated_at`;

// Numeric fields accepted on create/update, mapped 1:1 to columns
const NUMERIC_FIELDS = [
    'current_age', 'retirement_age', 'life_expectancy',
    'starting_portfolio', 'real_estate_value',
    'pre_retirement_return', 'post_retirement_return', 'inflation_rate',
    'social_security_monthly', 'social_security_start_age', 'pension_monthly',
    'rental_income_monthly', 'other_income_monthly',
    'withdrawal_rate', 'fixed_withdrawal_amount', 'annual_spending_goal',
];

async function liquidPortfolioTotal(userId) {
    const result = await query(
        `SELECT COALESCE(SUM(balance), 0) AS total
         FROM accounts
         WHERE user_id = $1 AND include_in_tracking = true AND archived_at IS NULL`,
        [userId]
    );
    return Number(result.rows[0].total);
}

// Year-by-year projection. Pre-retirement the portfolio compounds untouched;
// post-retirement it grows then pays out the chosen withdrawal each year.
function computeProjection(scenario, currentYear) {
    const currentAge = Number(scenario.current_age) || 62;
    const retirementAge = Number(scenario.retirement_age) || 67;
    const lifeExpectancy = Number(scenario.life_expectancy) || 90;
    const preReturn = Number(scenario.pre_retirement_return) / 100 || 0;
    const postReturn = Number(scenario.post_retirement_return) / 100 || 0;
    const inflation = Number(scenario.inflation_rate) / 100 || 0;
    const ssMonthly = Number(scenario.social_security_monthly) || 0;
    const ssStartAge = Number(scenario.social_security_start_age) || retirementAge;
    const pensionMonthly = Number(scenario.pension_monthly) || 0;
    const rentalMonthly = Number(scenario.rental_income_monthly) || 0;
    const otherMonthly = Number(scenario.other_income_monthly) || 0;
    const withdrawalRate = Number(scenario.withdrawal_rate) / 100 || 0;
    const withdrawalType = WITHDRAWAL_TYPES.includes(scenario.withdrawal_type)
        ? scenario.withdrawal_type : 'percentage';
    const fixedWithdrawal = Number(scenario.fixed_withdrawal_amount) || 0;
    const spendingGoal = Number(scenario.annual_spending_goal) || 0;

    let portfolio = Number(scenario.starting_portfolio) || 0;
    if (scenario.include_real_estate) {
        portfolio += Number(scenario.real_estate_value) || 0;
    }

    const yearlyData = [];
    let portfolioAtRetirement = null;
    let portfolioRunsOut = null;
    let totalLifetimeIncome = 0;
    let monthlyIncomeAtRetirement = null;

    for (let age = currentAge; age <= lifeExpectancy; age++) {
        const year = currentYear + (age - currentAge);
        const yearsFromNow = age - currentAge;
        const retired = age >= retirementAge;

        const socialSecurity = age >= ssStartAge ? ssMonthly * 12 : 0;
        const pensionIncome = retired ? pensionMonthly * 12 : 0;
        const rentalIncome = rentalMonthly * 12;
        const otherIncome = retired ? otherMonthly * 12 : 0;
        const guaranteedIncome = socialSecurity + pensionIncome + rentalIncome + otherIncome;
        const inflationAdjustedSpending = spendingGoal * (1 + inflation) ** yearsFromNow;

        let withdrawal = 0;
        let growth;

        if (!retired) {
            growth = portfolio * preReturn;
            portfolio += growth;
        } else {
            if (portfolioAtRetirement === null) {
                portfolioAtRetirement = portfolio;
            }
            if (withdrawalType === 'percentage') {
                withdrawal = portfolio * withdrawalRate;
            } else if (withdrawalType === 'fixed') {
                withdrawal = fixedWithdrawal;
            } else {
                withdrawal = Math.max(0, inflationAdjustedSpending - guaranteedIncome);
            }
            growth = portfolio * postReturn;
            portfolio = portfolio + growth - withdrawal;
            if (portfolio <= 0) {
                withdrawal = Math.max(0, withdrawal + portfolio); // partial final withdrawal
                portfolio = 0;
                if (portfolioRunsOut === null) {
                    portfolioRunsOut = year;
                }
            }
        }

        const totalIncome = withdrawal + guaranteedIncome;
        if (retired) {
            totalLifetimeIncome += totalIncome;
            if (monthlyIncomeAtRetirement === null) {
                monthlyIncomeAtRetirement = totalIncome / 12;
            }
        }

        yearlyData.push({
            year,
            age,
            portfolioValue: Math.round(portfolio),
            portfolioGrowth: Math.round(growth),
            withdrawalAmount: Math.round(withdrawal),
            socialSecurity: Math.round(socialSecurity),
            pensionIncome: Math.round(pensionIncome),
            rentalIncome: Math.round(rentalIncome),
            otherIncome: Math.round(otherIncome),
            totalIncome: Math.round(totalIncome),
            monthlyIncome: Math.round(totalIncome / 12),
            inflationAdjustedSpending: Math.round(inflationAdjustedSpending),
            retired,
        });
    }

    return {
        yearlyData,
        summary: {
            monthlyIncomeAtRetirement: Math.round(monthlyIncomeAtRetirement || 0),
            portfolioAtRetirement: Math.round(portfolioAtRetirement ?? portfolio),
            portfolioAtEndOfLife: Math.round(portfolio),
            totalLifetimeIncome: Math.round(totalLifetimeIncome),
            portfolioRunsOut,
            yearsOfRetirement: Math.max(0, lifeExpectancy - retirementAge),
        },
    };
}

router.get('/', requireAuth, async (req, res) => {
    try {
        let result = await query(
            `SELECT ${SCENARIO_COLUMNS}
             FROM retirement_scenarios
             WHERE user_id = $1
             ORDER BY created_at`,
            [req.user.id]
        );

        // Lazily seed a default scenario for users created after migration
        if (!result.rowCount) {
            const portfolio = await liquidPortfolioTotal(req.user.id);
            result = await query(
                `INSERT INTO retirement_scenarios (user_id, name, is_active, starting_portfolio)
                 VALUES ($1, 'Moderate', true, $2)
                 RETURNING ${SCENARIO_COLUMNS}`,
                [req.user.id, portfolio]
            );
        }

        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load scenarios' });
    }
});

function buildScenarioValues(body) {
    const values = {};
    for (const field of NUMERIC_FIELDS) {
        if (body[field] !== undefined) {
            values[field] = body[field] === null || body[field] === ''
                ? null
                : Number(body[field]);
            if (values[field] !== null && !Number.isFinite(values[field])) {
                throw Object.assign(new Error(`${field} must be a number`), { status: 400 });
            }
        }
    }
    if (body.name !== undefined) values.name = String(body.name).trim();
    if (body.color !== undefined) values.color = String(body.color).trim() || '#6366f1';
    if (body.include_real_estate !== undefined) values.include_real_estate = body.include_real_estate === true;
    if (body.withdrawal_type !== undefined) {
        if (!WITHDRAWAL_TYPES.includes(body.withdrawal_type)) {
            throw Object.assign(
                new Error(`withdrawal_type must be one of: ${WITHDRAWAL_TYPES.join(', ')}`),
                { status: 400 }
            );
        }
        values.withdrawal_type = body.withdrawal_type;
    }
    return values;
}

router.post('/', requireAuth, async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.name || !String(body.name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        const values = buildScenarioValues(body);
        if (values.starting_portfolio === undefined) {
            values.starting_portfolio = await liquidPortfolioTotal(req.user.id);
        }

        const cols = Object.keys(values);
        const params = [req.user.id, ...cols.map((c) => values[c])];
        const created = await query(
            `INSERT INTO retirement_scenarios (user_id, ${cols.join(', ')})
             VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
             RETURNING ${SCENARIO_COLUMNS}`,
            params
        );
        return res.status(201).json(created.rows[0]);
    } catch (error) {
        return res.status(error.status || 500).json({ error: error.message || 'Failed to create scenario' });
    }
});

router.put('/:id', requireAuth, async (req, res) => {
    try {
        const values = buildScenarioValues(req.body || {});
        if (values.name === '') {
            return res.status(400).json({ error: 'name cannot be empty' });
        }

        const cols = Object.keys(values);
        if (!cols.length) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
        const updated = await query(
            `UPDATE retirement_scenarios
             SET ${sets}, updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING ${SCENARIO_COLUMNS}`,
            [req.params.id, req.user.id, ...cols.map((c) => values[c])]
        );

        if (!updated.rowCount) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        return res.json(updated.rows[0]);
    } catch (error) {
        return res.status(error.status || 500).json({ error: error.message || 'Failed to update scenario' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await query(
            `DELETE FROM retirement_scenarios WHERE id = $1 AND user_id = $2
             RETURNING id, is_active`,
            [req.params.id, req.user.id]
        );
        if (!deleted.rowCount) {
            return res.status(404).json({ error: 'Scenario not found' });
        }

        // Keep exactly one active scenario when possible
        if (deleted.rows[0].is_active) {
            await query(
                `UPDATE retirement_scenarios SET is_active = true
                 WHERE id = (SELECT id FROM retirement_scenarios
                             WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
                [req.user.id]
            );
        }

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to delete scenario' });
    }
});

router.post('/:id/activate', requireAuth, async (req, res) => {
    try {
        const activated = await query(
            `UPDATE retirement_scenarios SET is_active = (id = $1), updated_at = NOW()
             WHERE user_id = $2
             RETURNING id, is_active`,
            [req.params.id, req.user.id]
        );

        if (!activated.rows.some((r) => r.id === req.params.id)) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to activate scenario' });
    }
});

router.get('/:id/projection', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT ${SCENARIO_COLUMNS}
             FROM retirement_scenarios
             WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'Scenario not found' });
        }

        const scenario = { ...result.rows[0] };
        // Fall back to live account totals when the scenario has no explicit portfolio
        if (scenario.starting_portfolio === null) {
            scenario.starting_portfolio = await liquidPortfolioTotal(req.user.id);
        }

        const projection = computeProjection(scenario, new Date().getFullYear());
        return res.json({ scenario: result.rows[0], ...projection });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to compute projection' });
    }
});

export default router;
