import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

// Aggregated net worth: liquid accounts + real estate (your equity share) +
// other assets + household members (optional combined view) − mortgages.
//
// ?view=combined   includes household member assets/liabilities
// ?view=self       default — user only
router.get('/', requireAuth, async (req, res) => {
    try {
        const viewCombined = req.query.view === 'combined';

        const [accountsResult, propertiesResult, otherAssetsResult, snapshotsResult, valuesResult, householdResult] = await Promise.all([
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
                        rental_income, rental_frequency, is_primary_residence, archived_at,
                        ownership_pct, commission_rate, sale_costs
                 FROM properties
                 WHERE user_id = $1 AND archived_at IS NULL
                 ORDER BY is_primary_residence DESC, created_at`,
                [req.user.id]
            ),
            query(
                `SELECT id, name, asset_type, estimated_value, ownership_pct,
                        generates_income, monthly_income, income_description,
                        expected_sale_age, expected_sale_value
                 FROM other_assets
                 WHERE user_id = $1 AND archived_at IS NULL
                 ORDER BY created_at`,
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
            // Always fetch household so summary endpoint works
            query(
                `SELECT estimated_assets, estimated_liabilities, monthly_income,
                        social_security_monthly, pension_monthly, include_in_combined, name
                 FROM household_members
                 WHERE user_id = $1
                 ORDER BY created_at`,
                [req.user.id]
            ),
        ]);

        const accounts = accountsResult.rows;

        // Compute ownership-aware RE fields
        const properties = propertiesResult.rows.map((p) => {
            const ownerFrac = Number(p.ownership_pct ?? 100) / 100;
            const fullValue = Number(p.estimated_value);
            const fullMortgage = Number(p.mortgage_balance) || 0;
            const yourValue = fullValue * ownerFrac;
            const yourMortgage = fullMortgage * ownerFrac;
            const yourEquity = yourValue - yourMortgage;
            const commissionRate = Number(p.commission_rate ?? 6) / 100;
            const commissionAmount = yourValue * commissionRate;
            const saleCosts = Number(p.sale_costs) || 0;
            return {
                ...p,
                equity: yourEquity,   // backward-compat alias
                yourValue,
                yourMortgage,
                yourEquity,
                commissionAmount,
                netEquityIfSold: yourEquity - commissionAmount - saleCosts,
            };
        });

        // Other assets — your ownership share
        const otherAssets = otherAssetsResult.rows.map((a) => {
            const yourShare = Number(a.estimated_value) * (Number(a.ownership_pct ?? 100) / 100);
            return { ...a, yourShare };
        });

        // Liquid = active, tracked accounts; other = archived or untracked
        const liquidAccounts = accounts.filter((a) => !a.archived_at && a.include_in_tracking !== false);
        const otherAccounts = accounts.filter((a) => a.archived_at || a.include_in_tracking === false);

        const liquidTotal = liquidAccounts.reduce((s, a) => s + Number(a.balance), 0);
        const otherAccountTotal = otherAccounts.reduce((s, a) => s + Number(a.balance), 0);

        // Real estate — your equity (ownership share)
        const reValue = properties.reduce((s, p) => s + p.yourValue, 0);
        const reMortgage = properties.reduce((s, p) => s + p.yourMortgage, 0);
        const reEquity = reValue - reMortgage;
        const reNetIfSold = properties.reduce((s, p) => s + p.netEquityIfSold, 0);

        // Other assets total (your share)
        const otherAssetsTotal = otherAssets.reduce((s, a) => s + a.yourShare, 0);
        const otherAssetsMonthlyIncome = otherAssets
            .filter((a) => a.generates_income)
            .reduce((s, a) => s + Number(a.monthly_income), 0);

        // Household combined (always computed, conditionally included in netWorth)
        const householdMembers = householdResult.rows;
        const combinedMembers = householdMembers.filter((m) => m.include_in_combined);
        const memberAssets = combinedMembers.reduce((s, m) => s + Number(m.estimated_assets), 0);
        const memberLiabilities = combinedMembers.reduce((s, m) => s + Number(m.estimated_liabilities), 0);

        const householdBoost = viewCombined ? (memberAssets - memberLiabilities) : 0;
        const netWorth = liquidTotal + reEquity + otherAssetsTotal + otherAccountTotal + householdBoost;

        // ---- Monthly history ----
        const monthKey = (d) => String(d).slice(0, 7); // YYYY-MM

        const liquidByMonth = new Map();
        for (const s of snapshotsResult.rows) {
            liquidByMonth.set(monthKey(s.snapped_at), Number(s.total));
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
            // Use full property values in history (ownership % applied at summary level)
            const reVal = [...lastValueByProperty.values()].reduce((s, v) => s + v, 0);
            const reEq = Math.max(0, reVal - reMortgage);
            history.push({
                month,
                liquid,
                realEstateEquity: reEq,
                other: otherAccountTotal + otherAssetsTotal,
                netWorth: liquid + reEq + otherAccountTotal + otherAssetsTotal,
            });
        }

        const response = {
            liquid: {
                total: liquidTotal,
                accounts: liquidAccounts,
            },
            realEstate: {
                totalValue: reValue,
                totalMortgage: reMortgage,
                totalEquity: reEquity,
                netEquityIfSold: reNetIfSold,
                properties,
            },
            otherAssets: {
                total: otherAssetsTotal,
                monthlyIncome: otherAssetsMonthlyIncome,
                assets: otherAssets,
            },
            // legacy "other" key for existing Net Worth page (archived/excluded accounts)
            other: {
                total: otherAccountTotal,
                accounts: otherAccounts,
            },
            liabilities: {
                total: reMortgage,
                mortgages: properties
                    .filter((p) => p.yourMortgage > 0)
                    .map((p) => ({ id: p.id, name: p.name, balance: p.yourMortgage })),
            },
            totalAssets: liquidTotal + reValue + otherAssetsTotal + otherAccountTotal,
            netWorth,
            history,
        };

        // Append household data when combined view is requested
        if (viewCombined || householdMembers.length > 0) {
            response.household = {
                members: householdMembers,
                memberAssets,
                memberLiabilities,
                memberNetWorth: memberAssets - memberLiabilities,
                included: viewCombined,
            };
            if (viewCombined) {
                response.combinedNetWorth = netWorth;
            }
        }

        return res.json(response);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load net worth' });
    }
});

export default router;
