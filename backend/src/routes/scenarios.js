import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { requireProfile, writeProfileId } from '../middleware/profile.js';
import { query } from '../db/client.js';

const router = Router();

const WITHDRAWAL_TYPES = ['percentage', 'fixed', 'income_gap'];

// ─── Recurring-income helpers (shared with /api/recurring-income) ─────────────

/**
 * Age at which a recurring income source begins paying.
 * Returns 0 for 'now' (already active), null for date-only sources (caller
 * should compare projectionYear against start_date).
 */
function srcStartAge(src) {
    if (src.start_type === 'now')  return 0;
    if (src.start_type === 'age')  return Number(src.start_age) || 0;
    return null; // 'date' — handled separately
}

/**
 * Age at which a recurring income source stops.  Null = lifetime.
 */
function srcEndAge(src, startAge) {
    if (src.end_type === 'lifetime') return null;
    if (src.end_type === 'age')      return Number(src.end_age)  || null;
    if (src.end_type === 'years')    return startAge != null ? startAge + (Number(src.end_years) || 0) : null;
    return null; // 'date' — handled separately
}

/**
 * True when `src` is paying at `age` in `projectionYear`.
 * currentAge is used to resolve 'now' start type.
 */
function isSrcActiveAtAge(src, age, currentAge, projectionYear) {
    const sa = srcStartAge(src);

    // — start gate —
    if (src.start_type === 'date' && src.start_date) {
        if (projectionYear < new Date(src.start_date).getFullYear()) return false;
    } else {
        const effectiveStart = sa ?? 0;
        if (age < effectiveStart) return false;
    }

    // — end gate —
    const effectiveStartAge = sa ?? currentAge;
    const ea = srcEndAge(src, effectiveStartAge);

    if (src.end_type === 'date' && src.end_date) {
        if (projectionYear >= new Date(src.end_date).getFullYear()) return false;
    } else if (ea !== null && age >= ea) {
        return false;
    }

    return true;
}

/**
 * Monthly amount for `src` at `age`, compounding annual_increase_pct
 * from the source's effective start age.
 */
function srcMonthlyAtAge(src, age, currentAge) {
    const base    = Number(src.monthly_amount) || 0;
    const growPct = Number(src.annual_increase_pct) || 0;
    if (!growPct) return base;
    const sa           = srcStartAge(src);
    const effectiveStart = sa ?? currentAge;
    const years          = Math.max(0, age - effectiveStart);
    return base * Math.pow(1 + growPct / 100, years);
}

/**
 * Sum all active recurring income sources at a given age.
 * Returns { annual, breakdown: [{name, type, monthly}] }.
 */
function recurringAt(sources, age, currentAge, projectionYear) {
    let annual = 0;
    const breakdown = [];
    for (const src of sources) {
        if (!isSrcActiveAtAge(src, age, currentAge, projectionYear)) continue;
        const monthly = srcMonthlyAtAge(src, age, currentAge);
        annual += monthly * 12;
        breakdown.push({
            id:      src.id,
            name:    src.name,
            type:    src.income_type,
            monthly: Math.round(monthly * 100) / 100,
        });
    }
    return { annual, breakdown };
}

const SCENARIO_COLUMNS = `
    id, name, is_active, color, current_age, retirement_age, life_expectancy,
    starting_portfolio, include_real_estate, real_estate_value,
    pre_retirement_return, post_retirement_return, inflation_rate,
    social_security_monthly, social_security_start_age, pension_monthly,
    rental_income_monthly, other_income_monthly,
    withdrawal_rate, withdrawal_type, fixed_withdrawal_amount,
    annual_spending_goal,
    include_spouse, spouse_ss_monthly, spouse_ss_age,
    spouse_pension_monthly, spouse_retirement_age,
    created_at, updated_at`;

// Numeric fields accepted on create/update, mapped 1:1 to columns
const NUMERIC_FIELDS = [
    'current_age', 'retirement_age', 'life_expectancy',
    'starting_portfolio', 'real_estate_value',
    'pre_retirement_return', 'post_retirement_return', 'inflation_rate',
    'social_security_monthly', 'social_security_start_age', 'pension_monthly',
    'rental_income_monthly', 'other_income_monthly',
    'withdrawal_rate', 'fixed_withdrawal_amount', 'annual_spending_goal',
    'spouse_ss_monthly', 'spouse_ss_age', 'spouse_pension_monthly', 'spouse_retirement_age',
];

async function liquidPortfolioTotal(userId, profileId = null) {
    const result = await query(
        `SELECT COALESCE(SUM(balance), 0) AS total
         FROM accounts
         WHERE user_id = $1 AND include_in_tracking = true AND archived_at IS NULL
           AND ($2::int IS NULL OR profile_id = $2)`,
        [userId, profileId]
    );
    return Number(result.rows[0].total);
}

// Year-by-year projection. Pre-retirement the portfolio compounds untouched;
// post-retirement it grows then pays out the chosen withdrawal each year.
// Exported for the email digest service.
//
// otherAssets: optional array of other_assets rows for business income / sale proceeds
// recurringIncomeSources: optional array of recurring_income rows.
//   When non-empty, guaranteed income is computed from those rows instead of
//   the scenario's social_security_monthly / pension_monthly / etc. fields.
//   Falls back to scenario fields when the array is empty (backward compat).
export function computeProjection(scenario, currentYear, otherAssets = [], recurringIncomeSources = []) {
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

    // Spouse/partner income fields
    const includeSpouse = scenario.include_spouse === true;
    const spouseSS = includeSpouse ? (Number(scenario.spouse_ss_monthly) || 0) : 0;
    const spouseSSAge = includeSpouse ? (Number(scenario.spouse_ss_age) || retirementAge) : retirementAge;
    const spousePension = includeSpouse ? (Number(scenario.spouse_pension_monthly) || 0) : 0;
    const spouseRetirementAge = includeSpouse ? (Number(scenario.spouse_retirement_age) || retirementAge) : retirementAge;

    let portfolio = Number(scenario.starting_portfolio) || 0;
    if (scenario.include_real_estate) {
        portfolio += Number(scenario.real_estate_value) || 0;
    }

    // Index other assets for fast lookup
    // incomeAssets: generate income up to (expected_sale_age OR retirement_age)
    // saleAssets: keyed by expected_sale_age
    const incomeAssets = otherAssets.filter((a) => a.generates_income && Number(a.monthly_income) > 0);
    const saleAssets = otherAssets.filter((a) => a.expected_sale_age != null);

    // Recurring-income mode: use the recurring_income table instead of scenario fields
    const useRecurring = recurringIncomeSources.length > 0;

    const yearlyData = [];
    let portfolioAtRetirement = null;
    let portfolioRunsOut = null;
    let totalLifetimeIncome = 0;
    let monthlyIncomeAtRetirement = null;
    let retirementIncomeBreakdown = null; // filled once, at the first retirement year

    for (let age = currentAge; age <= lifeExpectancy; age++) {
        const year = currentYear + (age - currentAge);
        const yearsFromNow = age - currentAge;
        const retired = age >= retirementAge;

        // Business/other asset income — included as long as asset not yet sold
        const otherAssetAnnualIncome = incomeAssets.reduce((s, a) => {
            const stopAge = a.expected_sale_age != null
                ? Math.min(Number(a.expected_sale_age), retirementAge)
                : retirementAge;
            return age < stopAge ? s + Number(a.monthly_income) * 12 : s;
        }, 0);

        // Sale proceeds arrive in the year age === expected_sale_age
        const saleProceedsThisYear = saleAssets.reduce((s, a) => {
            if (Number(a.expected_sale_age) === age) {
                const saleVal = a.expected_sale_value != null
                    ? Number(a.expected_sale_value)
                    : Number(a.estimated_value);
                return s + saleVal * (Number(a.ownership_pct ?? 100) / 100);
            }
            return s;
        }, 0);

        // ── Guaranteed income calculation ──────────────────────────────────────
        let socialSecurity, pensionIncome, spouseSSIncome, spousePensionIncome, rentalIncome, otherIncome;
        let guaranteedIncome, guaranteedIncomeRetired, recurringAnnual;

        if (useRecurring) {
            // Pull from recurring_income table — each source carries its own start/end logic
            const rec = recurringAt(recurringIncomeSources, age, currentAge, year);
            recurringAnnual        = rec.annual;
            // Other-asset (business) income sits on top of recurring sources, same as before
            guaranteedIncome       = recurringAnnual + (!retired ? otherAssetAnnualIncome : 0);
            guaranteedIncomeRetired = recurringAnnual + (retired  ? otherAssetAnnualIncome : 0);

            // Capture the breakdown at the first retirement year for the summary card
            if (retired && retirementIncomeBreakdown === null) {
                retirementIncomeBreakdown = rec.breakdown;
            }

            // Zero out legacy fields — they're no longer the source of truth.
            // yearlyData still carries them so the schema is stable; frontend
            // prefers retirementIncomeBreakdown when it is present.
            socialSecurity      = 0;
            pensionIncome       = 0;
            spouseSSIncome      = 0;
            spousePensionIncome = 0;
            rentalIncome        = 0;
            otherIncome         = 0;
        } else {
            // ── Original scenario-field fallback ──────────────────────────────
            recurringAnnual         = 0;
            socialSecurity          = age >= ssStartAge ? ssMonthly * 12 : 0;
            pensionIncome           = retired ? pensionMonthly * 12 : 0;
            spouseSSIncome          = (includeSpouse && age >= spouseSSAge) ? spouseSS * 12 : 0;
            spousePensionIncome     = (includeSpouse && age >= spouseRetirementAge) ? spousePension * 12 : 0;
            rentalIncome            = rentalMonthly * 12;
            otherIncome             = retired ? otherMonthly * 12 : 0;
            guaranteedIncome        = socialSecurity + pensionIncome + spouseSSIncome + spousePensionIncome
                                        + rentalIncome + otherIncome + (retired ? 0 : otherAssetAnnualIncome);
            guaranteedIncomeRetired = socialSecurity + pensionIncome + spouseSSIncome + spousePensionIncome
                                        + rentalIncome + otherIncome + (retired ? otherAssetAnnualIncome : 0);
        }

        const inflationAdjustedSpending = spendingGoal * (1 + inflation) ** yearsFromNow;

        let withdrawal = 0;
        let growth;

        if (!retired) {
            // Add sale proceeds to portfolio even pre-retirement
            portfolio += saleProceedsThisYear;
            growth = portfolio * preReturn;
            portfolio += growth;
        } else {
            if (portfolioAtRetirement === null) {
                portfolioAtRetirement = portfolio;
            }
            // Add sale proceeds before computing withdrawal
            portfolio += saleProceedsThisYear;

            if (withdrawalType === 'percentage') {
                withdrawal = portfolio * withdrawalRate;
            } else if (withdrawalType === 'fixed') {
                withdrawal = fixedWithdrawal;
            } else {
                // income_gap: only withdraw what guaranteed income doesn't cover
                withdrawal = Math.max(0, inflationAdjustedSpending - guaranteedIncomeRetired);
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

        const totalIncome = withdrawal + (retired ? guaranteedIncomeRetired : 0);
        if (retired) {
            totalLifetimeIncome += totalIncome;
            if (monthlyIncomeAtRetirement === null) {
                monthlyIncomeAtRetirement = totalIncome / 12;
            }
        }

        yearlyData.push({
            year,
            age,
            portfolioValue:            Math.round(portfolio),
            portfolioGrowth:           Math.round(growth || 0),
            withdrawalAmount:          Math.round(withdrawal),
            guaranteedIncomeAnnual:    Math.round(retired ? guaranteedIncomeRetired : guaranteedIncome),
            // Legacy per-source fields (0 when useRecurring; still present for backward compat)
            socialSecurity:            Math.round(socialSecurity),
            pensionIncome:             Math.round(pensionIncome),
            spouseSocialSecurity:      Math.round(spouseSSIncome),
            spousePension:             Math.round(spousePensionIncome),
            rentalIncome:              Math.round(rentalIncome),
            otherIncome:               Math.round(otherIncome),
            otherAssetIncome:          Math.round(otherAssetAnnualIncome),
            saleProceeds:              Math.round(saleProceedsThisYear),
            totalIncome:               Math.round(totalIncome),
            monthlyIncome:             Math.round(totalIncome / 12),
            inflationAdjustedSpending: Math.round(inflationAdjustedSpending),
            retired,
        });
    }

    // Build the retirementIncomeBreakdown for fallback (scenario-field) mode
    if (!useRecurring && portfolioAtRetirement !== null) {
        const first = yearlyData.find((r) => r.retired);
        if (first) {
            retirementIncomeBreakdown = [
                ...(first.socialSecurity   > 0 ? [{ name: 'Social Security',   type: 'social_security', monthly: Math.round(first.socialSecurity   / 12) }] : []),
                ...(first.spouseSocialSecurity > 0 ? [{ name: 'Spouse SS',     type: 'social_security', monthly: Math.round(first.spouseSocialSecurity / 12) }] : []),
                ...(first.pensionIncome    > 0 ? [{ name: 'Pension',           type: 'pension',         monthly: Math.round(first.pensionIncome    / 12) }] : []),
                ...(first.spousePension    > 0 ? [{ name: 'Spouse Pension',    type: 'pension',         monthly: Math.round(first.spousePension    / 12) }] : []),
                ...(first.rentalIncome     > 0 ? [{ name: 'Rental income',     type: 'rental',          monthly: Math.round(first.rentalIncome     / 12) }] : []),
                ...(first.otherAssetIncome > 0 ? [{ name: 'Business income',   type: 'other',           monthly: Math.round(first.otherAssetIncome / 12) }] : []),
                ...(first.otherIncome      > 0 ? [{ name: 'Other income',      type: 'other',           monthly: Math.round(first.otherIncome      / 12) }] : []),
            ];
        }
    }

    return {
        yearlyData,
        summary: {
            monthlyIncomeAtRetirement: Math.round(monthlyIncomeAtRetirement || 0),
            portfolioAtRetirement:     Math.round(portfolioAtRetirement ?? portfolio),
            portfolioAtEndOfLife:      Math.round(portfolio),
            totalLifetimeIncome:       Math.round(totalLifetimeIncome),
            portfolioRunsOut,
            yearsOfRetirement:         Math.max(0, lifeExpectancy - retirementAge),
            includeSpouse,
            spouseSS,
            spouseSSAge,
            spousePension,
            // Rich breakdown at the first retirement year (available in both modes)
            retirementIncomeBreakdown,
            usedRecurringIncome: useRecurring,
        },
    };
}

// ─── Monte Carlo engine ──────────────────────────────────────────────────────

const MC_STDDEV = 0.12; // historical equity-market annual volatility

// Box-Muller transform → standard normal draw
function randNormal() {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Pre-generated shock matrix lets every rate evaluation in the SWR binary
// search reuse identical randomness (common random numbers), which keeps the
// success-rate curve monotone in the withdrawal rate.
function generateShocks(numSims, numYears) {
    const shocks = [];
    for (let s = 0; s < numSims; s++) {
        const row = new Float64Array(numYears);
        for (let y = 0; y < numYears; y++) row[y] = randNormal();
        shocks.push(row);
    }
    return shocks;
}

function normalizeScenario(scenario) {
    const currentAge = Number(scenario.current_age) || 62;
    const retirementAge = Number(scenario.retirement_age) || 67;
    return {
        currentAge,
        retirementAge,
        lifeExpectancy: Number(scenario.life_expectancy) || 90,
        preReturn: Number(scenario.pre_retirement_return) / 100 || 0,
        postReturn: Number(scenario.post_retirement_return) / 100 || 0,
        inflation: Number(scenario.inflation_rate) / 100 || 0,
        ssMonthly: Number(scenario.social_security_monthly) || 0,
        ssStartAge: Number(scenario.social_security_start_age) || retirementAge,
        pensionMonthly: Number(scenario.pension_monthly) || 0,
        rentalMonthly: Number(scenario.rental_income_monthly) || 0,
        otherMonthly: Number(scenario.other_income_monthly) || 0,
        withdrawalRate: Number(scenario.withdrawal_rate) / 100 || 0,
        withdrawalType: WITHDRAWAL_TYPES.includes(scenario.withdrawal_type)
            ? scenario.withdrawal_type : 'percentage',
        fixedWithdrawal: Number(scenario.fixed_withdrawal_amount) || 0,
        spendingGoal: Number(scenario.annual_spending_goal) || 0,
        startingPortfolio: (Number(scenario.starting_portfolio) || 0)
            + (scenario.include_real_estate ? (Number(scenario.real_estate_value) || 0) : 0),
    };
}

function guaranteedIncomeAt(params, age) {
    const retired = age >= params.retirementAge;
    return (age >= params.ssStartAge ? params.ssMonthly * 12 : 0)
        + (retired ? params.pensionMonthly * 12 : 0)
        + params.rentalMonthly * 12
        + (retired ? params.otherMonthly * 12 : 0);
}

/**
 * Runs one simulated lifetime path. Returns { values: [per-year portfolio],
 * runOutAge: age the portfolio hit 0 (null = survived) }.
 *
 * swrOverride: when set, ignores the scenario's withdrawal strategy and
 * withdraws (rate × portfolio-at-retirement) in year one, inflation-adjusted
 * thereafter — the classic SWR definition.
 */
function simulatePath(params, shockRow, swrOverride = null) {
    let portfolio = params.startingPortfolio;
    let runOutAge = null;
    let swrBaseWithdrawal = null;
    const values = [];

    for (let age = params.currentAge, y = 0; age <= params.lifeExpectancy; age++, y++) {
        const retired = age >= params.retirementAge;
        const yearsFromNow = age - params.currentAge;
        const mean = retired ? params.postReturn : params.preReturn;
        const ret = mean + MC_STDDEV * shockRow[y];

        if (!retired) {
            portfolio *= (1 + ret);
        } else {
            let withdrawal;
            if (swrOverride != null) {
                if (swrBaseWithdrawal === null) swrBaseWithdrawal = portfolio * swrOverride;
                withdrawal = swrBaseWithdrawal * (1 + params.inflation) ** (age - params.retirementAge);
            } else if (params.withdrawalType === 'percentage') {
                withdrawal = portfolio * params.withdrawalRate;
            } else if (params.withdrawalType === 'fixed') {
                withdrawal = params.fixedWithdrawal;
            } else {
                const spending = params.spendingGoal * (1 + params.inflation) ** yearsFromNow;
                withdrawal = Math.max(0, spending - guaranteedIncomeAt(params, age));
            }
            portfolio = portfolio * (1 + ret) - withdrawal;
            if (portfolio <= 0) {
                portfolio = 0;
                if (runOutAge === null) runOutAge = age;
            }
        }
        values.push(portfolio);
    }

    return { values, runOutAge };
}

function percentile(sortedArr, p) {
    if (!sortedArr.length) return 0;
    const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.round((p / 100) * (sortedArr.length - 1))));
    return sortedArr[idx];
}

// Deterministic portfolio value at retirement (no randomness) — used for SWR
// monthly-income figures so they're stable across runs.
function deterministicPortfolioAtRetirement(params) {
    let portfolio = params.startingPortfolio;
    for (let age = params.currentAge; age < params.retirementAge; age++) {
        portfolio *= (1 + params.preReturn);
    }
    return portfolio;
}

router.get('/:id/monte-carlo', requireAuth, requireProfile, async (req, res) => {
    try {
        const result = await query(
            `SELECT ${SCENARIO_COLUMNS} FROM retirement_scenarios WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'Scenario not found' });
        }

        const scenario = { ...result.rows[0] };
        if (scenario.starting_portfolio === null) {
            scenario.starting_portfolio = await liquidPortfolioTotal(req.user.id, req.profileId);
        }
        const params = normalizeScenario(scenario);
        const numYears = params.lifeExpectancy - params.currentAge + 1;
        const NUM_SIMS = 1000;

        const shocks = generateShocks(NUM_SIMS, numYears);
        const paths = shocks.map((row) => simulatePath(params, row));

        const endValues = paths.map((p) => p.values[p.values.length - 1]).sort((a, b) => a - b);
        const successCount = paths.filter((p) => p.runOutAge === null).length;

        const runsOutBefore = {};
        for (const age of [70, 75, 80, 85, 90]) {
            if (age > params.lifeExpectancy) continue;
            const count = paths.filter((p) => p.runOutAge !== null && p.runOutAge < age).length;
            runsOutBefore[`age${age}`] = Math.round((count / NUM_SIMS) * 1000) / 10;
        }

        const currentYear = new Date().getFullYear();
        const fanChartData = [];
        for (let y = 0; y < numYears; y++) {
            const yearValues = paths.map((p) => p.values[y]).sort((a, b) => a - b);
            fanChartData.push({
                year: currentYear + y,
                age: params.currentAge + y,
                p10: Math.round(percentile(yearValues, 10)),
                p25: Math.round(percentile(yearValues, 25)),
                p50: Math.round(percentile(yearValues, 50)),
                p75: Math.round(percentile(yearValues, 75)),
                p90: Math.round(percentile(yearValues, 90)),
            });
        }

        return res.json({
            numSimulations: NUM_SIMS,
            successRate: Math.round((successCount / NUM_SIMS) * 1000) / 10,
            medianEndValue: Math.round(percentile(endValues, 50)),
            percentile10: Math.round(percentile(endValues, 10)),
            percentile25: Math.round(percentile(endValues, 25)),
            percentile50: Math.round(percentile(endValues, 50)),
            percentile75: Math.round(percentile(endValues, 75)),
            percentile90: Math.round(percentile(endValues, 90)),
            runsOutBefore,
            fanChartData,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Monte Carlo simulation failed' });
    }
});

router.get('/:id/safe-withdrawal-rate', requireAuth, requireProfile, async (req, res) => {
    try {
        const result = await query(
            `SELECT ${SCENARIO_COLUMNS} FROM retirement_scenarios WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'Scenario not found' });
        }

        const scenario = { ...result.rows[0] };
        if (scenario.starting_portfolio === null) {
            scenario.starting_portfolio = await liquidPortfolioTotal(req.user.id, req.profileId);
        }
        const params = normalizeScenario(scenario);
        const numYears = params.lifeExpectancy - params.currentAge + 1;
        const NUM_SIMS = 1000;

        const shocks = generateShocks(NUM_SIMS, numYears);
        const successRateFor = (ratePct) => {
            const rate = ratePct / 100;
            let success = 0;
            for (const row of shocks) {
                if (simulatePath(params, row, rate).runOutAge === null) success++;
            }
            return (success / NUM_SIMS) * 100;
        };

        // Success falls monotonically as the rate rises (same shocks reused),
        // so bisection finds the highest rate that still clears the target.
        const maxRateForSuccess = (targetPct) => {
            let lo = 1;
            let hi = 10;
            if (successRateFor(hi) >= targetPct) return hi;
            if (successRateFor(lo) < targetPct) return lo;
            for (let i = 0; i < 12; i++) {
                const mid = (lo + hi) / 2;
                if (successRateFor(mid) >= targetPct) lo = mid;
                else hi = mid;
            }
            return Math.round(lo * 10) / 10;
        };

        const portfolioAtRetirement = deterministicPortfolioAtRetirement(params);
        const monthlyFor = (ratePct) => Math.round((portfolioAtRetirement * ratePct / 100) / 12);

        const safeRate = maxRateForSuccess(95);
        const conservativeRate = maxRateForSuccess(99);
        const aggressiveRate = maxRateForSuccess(85);

        const rateTable = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 7.0].map((rate) => ({
            rate,
            successRate: Math.round(successRateFor(rate) * 10) / 10,
            monthlyIncome: monthlyFor(rate),
        }));

        return res.json({
            safeRate,
            conservativeRate,
            aggressiveRate,
            safeMonthlyIncome: monthlyFor(safeRate),
            conservativeMonthlyIncome: monthlyFor(conservativeRate),
            aggressiveMonthlyIncome: monthlyFor(aggressiveRate),
            portfolioAtRetirement: Math.round(portfolioAtRetirement),
            rateTable,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'SWR calculation failed' });
    }
});

router.get('/', requireAuth, requireProfile, async (req, res) => {
    try {
        let result = await query(
            `SELECT ${SCENARIO_COLUMNS}
             FROM retirement_scenarios
             WHERE user_id = $1
               AND ($2::int IS NULL OR profile_id = $2)
             ORDER BY created_at`,
            [req.user.id, req.profileId]
        );

        // Lazily seed a default scenario for profiles that have none yet
        if (!result.rowCount && req.profileId) {
            const portfolio = await liquidPortfolioTotal(req.user.id, req.profileId);
            result = await query(
                `INSERT INTO retirement_scenarios (user_id, profile_id, name, is_active, starting_portfolio)
                 VALUES ($1, $2, 'Moderate', true, $3)
                 RETURNING ${SCENARIO_COLUMNS}`,
                [req.user.id, req.profileId, portfolio]
            );
        } else if (!result.rowCount) {
            const portfolio = await liquidPortfolioTotal(req.user.id, null);
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
    if (body.include_spouse !== undefined) values.include_spouse = body.include_spouse === true;
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

router.post('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.name || !String(body.name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }
        const values = buildScenarioValues(body);
        const effectiveProfileId = writeProfileId(req);
        if (values.starting_portfolio === undefined) {
            values.starting_portfolio = await liquidPortfolioTotal(req.user.id, effectiveProfileId);
        }

        const cols = Object.keys(values);
        const params = [req.user.id, effectiveProfileId, ...cols.map((c) => values[c])];
        const created = await query(
            `INSERT INTO retirement_scenarios (user_id, profile_id, ${cols.join(', ')})
             VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')})
             RETURNING ${SCENARIO_COLUMNS}`,
            params
        );
        return res.status(201).json(created.rows[0]);
    } catch (error) {
        return res.status(error.status || 500).json({ error: error.message || 'Failed to create scenario' });
    }
});

router.put('/:id', requireAuth, requireProfile, async (req, res) => {
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

router.delete('/:id', requireAuth, requireProfile, async (req, res) => {
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

router.post('/:id/activate', requireAuth, requireProfile, async (req, res) => {
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

router.get('/:id/projection', requireAuth, requireProfile, async (req, res) => {
    try {
        const profileId = req.profileId;

        const [scenarioResult, otherAssetsResult, recurringResult] = await Promise.all([
            query(
                `SELECT ${SCENARIO_COLUMNS}
                 FROM retirement_scenarios
                 WHERE id = $1 AND user_id = $2`,
                [req.params.id, req.user.id]
            ),
            query(
                `SELECT id, name, asset_type, estimated_value, ownership_pct,
                        generates_income, monthly_income, income_description,
                        expected_sale_age, expected_sale_value
                 FROM other_assets
                 WHERE user_id = $1 AND archived_at IS NULL
                   AND ($2::int IS NULL OR profile_id = $2)`,
                [req.user.id, profileId]
            ),
            // Fetch active recurring income sources for this profile.
            // profileId = null means combined view → aggregate all profiles.
            query(
                `SELECT id, name, income_type, monthly_amount,
                        start_type, start_age, start_date,
                        end_type, end_age, end_date, end_years,
                        annual_increase_pct, is_inflation_adjusted,
                        tax_treatment
                 FROM recurring_income
                 WHERE user_id = $1
                   AND ($2::int IS NULL OR profile_id = $2)
                   AND is_active = true
                 ORDER BY COALESCE(start_age, 0) ASC, created_at ASC`,
                [req.user.id, profileId]
            ),
        ]);

        if (!scenarioResult.rowCount) {
            return res.status(404).json({ error: 'Scenario not found' });
        }

        const scenario = { ...scenarioResult.rows[0] };
        // Fall back to live account totals when the scenario has no explicit portfolio
        if (scenario.starting_portfolio === null) {
            scenario.starting_portfolio = await liquidPortfolioTotal(req.user.id, profileId);
        }

        const otherAssets          = otherAssetsResult.rows;
        const recurringIncomeSources = recurringResult.rows;

        const projection = computeProjection(
            scenario,
            new Date().getFullYear(),
            otherAssets,
            recurringIncomeSources,   // ← new: drives guaranteed-income when non-empty
        );
        return res.json({ scenario: scenarioResult.rows[0], ...projection });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to compute projection' });
    }
});

export default router;
