import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';
import { computeProjection } from './scenarios.js';

const router = Router();

/**
 * GET /api/reports/summary
 * Everything the printable /report page needs in one call.
 */
router.get('/summary', requireAuth, async (req, res) => {
    try {
        const [userResult, accountsResult, propertiesResult, scenarioResult, snapshotsResult] =
            await Promise.all([
                query(`SELECT email, full_name FROM users WHERE id = $1`, [req.user.id]),
                query(
                    `SELECT COALESCE(display_name, name) AS name, type, balance,
                            include_in_tracking, archived_at
                     FROM accounts
                     WHERE user_id = $1
                     ORDER BY balance DESC`,
                    [req.user.id]
                ),
                query(
                    `SELECT name, property_type, estimated_value, mortgage_balance,
                            purchase_price, rental_income, rental_frequency
                     FROM properties
                     WHERE user_id = $1 AND archived_at IS NULL
                     ORDER BY estimated_value DESC`,
                    [req.user.id]
                ),
                query(
                    `SELECT * FROM retirement_scenarios
                     WHERE user_id = $1 AND is_active = true
                     LIMIT 1`,
                    [req.user.id]
                ),
                query(
                    `SELECT total, snapped_at::text AS snapped_at
                     FROM snapshots WHERE user_id = $1
                     ORDER BY snapped_at DESC LIMIT 1`,
                    [req.user.id]
                ),
            ]);

        const accounts = accountsResult.rows;
        const tracked = accounts.filter((a) => !a.archived_at && a.include_in_tracking !== false);
        const liquidTotal = tracked.reduce((s, a) => s + Number(a.balance), 0);

        const properties = propertiesResult.rows.map((p) => ({
            ...p,
            equity: Number(p.estimated_value) - (Number(p.mortgage_balance) || 0),
        }));
        const reValue = properties.reduce((s, p) => s + Number(p.estimated_value), 0);
        const reMortgage = properties.reduce((s, p) => s + (Number(p.mortgage_balance) || 0), 0);

        const scenario = scenarioResult.rows[0] || null;
        let projectionSummary = null;
        let scenarioName = null;
        if (scenario) {
            scenarioName = scenario.name;
            const projection = computeProjection(
                { ...scenario, starting_portfolio: scenario.starting_portfolio ?? liquidTotal },
                new Date().getFullYear()
            );
            projectionSummary = projection.summary;
        }

        return res.json({
            generatedAt: new Date().toISOString(),
            user: {
                name: userResult.rows[0]?.full_name || null,
                email: userResult.rows[0]?.email,
            },
            netWorth: {
                liquid: liquidTotal,
                realEstateValue: reValue,
                realEstateMortgage: reMortgage,
                realEstateEquity: reValue - reMortgage,
                total: liquidTotal + reValue - reMortgage,
            },
            accounts: tracked.map((a) => ({ name: a.name, type: a.type, balance: Number(a.balance) })),
            properties,
            lastSnapshot: snapshotsResult.rows[0] || null,
            activeScenario: scenarioName,
            projection: projectionSummary,
            goalProgressPct: projectionSummary?.portfolioAtRetirement > 0
                ? Math.min(100, (liquidTotal / projectionSummary.portfolioAtRetirement) * 100)
                : null,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to build report' });
    }
});

export default router;
