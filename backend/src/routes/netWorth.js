import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

// Aggregated net worth: liquid accounts + real estate + other assets − mortgages.
// Real estate is listed in assets at market value with mortgages under
// liabilities, so equity is never double-counted.
router.get('/', requireAuth, async (req, res) => {
    try {
        const [accountsResult, propertiesResult, snapshotsResult, valuesResult] = await Promise.all([
            query(
                `SELECT id, name, display_name, type, balance, include_in_tracking,
                        archived_at, institution
                 FROM accounts
                 WHERE user_id = $1
                 ORDER BY balance DESC`,
                [req.user.id]
            ),
            query(
                `SELECT id, name, property_type, estimated_value, mortgage_balance,
                        rental_income, rental_frequency, is_primary_residence, archived_at
                 FROM properties
                 WHERE user_id = $1 AND archived_at IS NULL
                 ORDER BY is_primary_residence DESC, created_at`,
                [req.user.id]
            ),
            query(
                `SELECT total, snapped_at
                 FROM snapshots
                 WHERE user_id = $1
                 ORDER BY snapped_at`,
                [req.user.id]
            ),
            query(
                `SELECT pv.property_id, pv.estimated_value, pv.recorded_date
                 FROM property_values pv
                 JOIN properties p ON p.id = pv.property_id
                 WHERE p.user_id = $1 AND p.archived_at IS NULL
                 ORDER BY pv.recorded_date`,
                [req.user.id]
            ),
        ]);

        const accounts = accountsResult.rows;
        const properties = propertiesResult.rows.map((p) => ({
            ...p,
            equity: Number(p.estimated_value) - (Number(p.mortgage_balance) || 0),
        }));

        // Liquid = active, tracked accounts; other = archived or untracked
        const liquidAccounts = accounts.filter((a) => !a.archived_at && a.include_in_tracking !== false);
        const otherAccounts = accounts.filter((a) => a.archived_at || a.include_in_tracking === false);

        const liquidTotal = liquidAccounts.reduce((s, a) => s + Number(a.balance), 0);
        const otherTotal = otherAccounts.reduce((s, a) => s + Number(a.balance), 0);
        const reValue = properties.reduce((s, p) => s + Number(p.estimated_value), 0);
        const reMortgage = properties.reduce((s, p) => s + (Number(p.mortgage_balance) || 0), 0);
        const reEquity = reValue - reMortgage;

        const netWorth = liquidTotal + reEquity + otherTotal;

        // ---- Monthly history ----
        // Liquid comes from snapshots; property values carry forward from
        // property_values. Mortgages and "other" have no history, so today's
        // figures apply across the series.
        const monthKey = (d) => String(d).slice(0, 7); // YYYY-MM

        const liquidByMonth = new Map();
        for (const s of snapshotsResult.rows) {
            liquidByMonth.set(monthKey(s.snapped_at), Number(s.total)); // last snapshot in month wins
        }

        const valuesByProperty = new Map();
        for (const v of valuesResult.rows) {
            if (!valuesByProperty.has(v.property_id)) valuesByProperty.set(v.property_id, []);
            valuesByProperty.get(v.property_id).push({ month: monthKey(v.recorded_date), value: Number(v.estimated_value) });
        }

        const allMonths = new Set([
            ...liquidByMonth.keys(),
            ...valuesResult.rows.map((v) => monthKey(v.recorded_date)),
        ]);
        const months = [...allMonths].sort();

        const history = [];
        let lastLiquid = null;
        const lastValueByProperty = new Map();
        for (const month of months) {
            if (liquidByMonth.has(month)) lastLiquid = liquidByMonth.get(month);
            for (const [propertyId, points] of valuesByProperty) {
                for (const point of points) {
                    if (point.month === month) lastValueByProperty.set(propertyId, point.value);
                }
            }
            const liquid = lastLiquid ?? 0;
            const reVal = [...lastValueByProperty.values()].reduce((s, v) => s + v, 0);
            const reEq = Math.max(0, reVal - reMortgage);
            history.push({
                month,
                liquid,
                realEstateEquity: reEq,
                other: otherTotal,
                netWorth: liquid + reEq + otherTotal,
            });
        }

        return res.json({
            liquid: {
                total: liquidTotal,
                accounts: liquidAccounts,
            },
            realEstate: {
                totalValue: reValue,
                totalMortgage: reMortgage,
                totalEquity: reEquity,
                properties,
            },
            other: {
                total: otherTotal,
                accounts: otherAccounts,
            },
            liabilities: {
                total: reMortgage,
                mortgages: properties
                    .filter((p) => Number(p.mortgage_balance) > 0)
                    .map((p) => ({ id: p.id, name: p.name, balance: Number(p.mortgage_balance) })),
            },
            totalAssets: liquidTotal + reValue + otherTotal,
            netWorth,
            history,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load net worth' });
    }
});

export default router;
