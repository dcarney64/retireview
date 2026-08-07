import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

// ─── 2026 federal tax brackets ───────────────────────────────────────────────
// Each entry: [rate %, lower bound, upper bound]. Lower bound is inclusive.
const BRACKETS = {
    single: [
        [10, 0, 11925],
        [12, 11926, 48475],
        [22, 48476, 103350],
        [24, 103351, 197300],
        [32, 197301, 250525],
        [35, 250526, 626350],
        [37, 626351, Infinity],
    ],
    married: [
        [10, 0, 23850],
        [12, 23851, 96950],
        [22, 96951, 206700],
        [24, 206701, 394600],
        [32, 394601, 501050],
        [35, 501051, 751600],
        [37, 751601, Infinity],
    ],
};

// ─── 2026 Medicare IRMAA tiers ───────────────────────────────────────────────
// threshold = top of the tier's income range (MAGI, 2-year lookback ignored
// here — we compare against projected retirement income directly).
const IRMAA_BASE_PREMIUM = 185.00;
const IRMAA_TIERS = {
    single: [
        { tier: 0, threshold: 106000, surcharge: 0 },
        { tier: 1, threshold: 133000, surcharge: 74.90 },
        { tier: 2, threshold: 167000, surcharge: 187.90 },
        { tier: 3, threshold: 200000, surcharge: 300.90 },
        { tier: 4, threshold: 500000, surcharge: 413.90 },
        { tier: 5, threshold: Infinity, surcharge: 476.90 },
    ],
    married: [
        { tier: 0, threshold: 212000, surcharge: 0 },
        { tier: 1, threshold: 266000, surcharge: 74.90 },
        { tier: 2, threshold: 334000, surcharge: 187.90 },
        { tier: 3, threshold: 400000, surcharge: 300.90 },
        { tier: 4, threshold: 750000, surcharge: 413.90 },
        { tier: 5, threshold: Infinity, surcharge: 476.90 },
    ],
};

// Social Security benefit as % of the full (FRA = 67) benefit by claiming age
const SS_PCT_BY_AGE = { 62: 70, 63: 75, 64: 80, 65: 86.7, 66: 93.3, 67: 100, 68: 108, 69: 116, 70: 124 };

const IRA_GROWTH_RATE = 0.07; // assumed growth of unconverted IRA dollars

function filingStatusOf(req) {
    return req.query.filingStatus === 'married' ? 'married' : 'single';
}

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function bracketFor(income, status) {
    return BRACKETS[status].find(([, lo, hi]) => income >= lo && income <= hi)
        || BRACKETS[status][BRACKETS[status].length - 1];
}

function marginalRate(income, status) {
    return bracketFor(income, status)[0];
}

// ─── GET /api/tax/roth-conversion ────────────────────────────────────────────

router.get('/roth-conversion', requireAuth, async (req, res) => {
    try {
        const status = filingStatusOf(req);

        // Default IRA balances from account names when not supplied
        let defaultTraditional = 0;
        let defaultRoth = 0;
        if (req.query.traditionalIraBalance === undefined || req.query.rothIraBalance === undefined) {
            const accounts = await query(
                `SELECT name, display_name, balance FROM accounts
                 WHERE user_id = $1 AND archived_at IS NULL AND include_in_tracking = true`,
                [req.user.id]
            );
            for (const a of accounts.rows) {
                const label = `${a.display_name || ''} ${a.name}`.toLowerCase();
                if (label.includes('roth')) defaultRoth += Number(a.balance);
                else if (label.includes('traditional') || label.includes('ira') || label.includes('401')) {
                    defaultTraditional += Number(a.balance);
                }
            }
        }

        const currentIncome = num(req.query.currentIncome, 80000);
        const traditionalIraBalance = num(req.query.traditionalIraBalance, defaultTraditional);
        const rothIraBalance = num(req.query.rothIraBalance, defaultRoth);
        const currentAge = num(req.query.currentAge, 62);
        const retirementAge = num(req.query.retirementAge, 67);
        const expectedRetirementIncome = num(req.query.expectedRetirementIncome, 0);

        const currentBracket = bracketFor(currentIncome, status);
        const currentMarginalRate = currentBracket[0];
        const retirementMarginalRate = marginalRate(expectedRetirementIncome, status);

        const shouldConvert = retirementMarginalRate > currentMarginalRate && traditionalIraBalance > 0;

        // Headroom left in the current bracket
        const bracketHeadroom = Number.isFinite(currentBracket[2])
            ? Math.max(0, currentBracket[2] - currentIncome)
            : 0;
        const optimalConversionAmount = shouldConvert
            ? Math.round(Math.min(bracketHeadroom, traditionalIraBalance))
            : 0;

        const yearsToRetirement = Math.max(0, retirementAge - currentAge);
        const taxCostNow = Math.round(optimalConversionAmount * currentMarginalRate / 100);
        // If you wait, the same dollars grow tax-deferred and come out at the
        // retirement marginal rate.
        const taxCostIfWait = Math.round(
            optimalConversionAmount * (1 + IRA_GROWTH_RATE) ** yearsToRetirement * retirementMarginalRate / 100
        );
        const taxSavings = Math.max(0, taxCostIfWait - taxCostNow);

        const reason = shouldConvert
            ? `Your expected retirement tax rate (${retirementMarginalRate}%) is higher than your current rate `
              + `(${currentMarginalRate}%). Converting now, while filling the rest of your ${currentMarginalRate}% `
              + `bracket, locks in the lower rate.`
            : traditionalIraBalance <= 0
                ? 'No traditional IRA balance found to convert.'
                : `Your current tax rate (${currentMarginalRate}%) is not lower than your expected retirement rate `
                  + `(${retirementMarginalRate}%), so converting now offers no bracket arbitrage.`;

        const brackets = BRACKETS[status]
            .filter(([, lo]) => Number.isFinite(lo))
            .slice(0, 6)
            .map(([rate, from, to]) => {
                const size = Number.isFinite(to) ? to - from + (from === 0 ? 0 : 1) : null;
                const filled = Math.max(0, Math.min(currentIncome, Number.isFinite(to) ? to : currentIncome) - from + (from === 0 ? 0 : 1));
                const available = currentIncome >= (Number.isFinite(to) ? to : Infinity)
                    ? 0
                    : size === null ? null : size - filled;
                return {
                    rate,
                    from,
                    to: Number.isFinite(to) ? to : null,
                    filled: Math.round(Math.min(filled, size ?? filled)),
                    available: available === null ? null : Math.round(available),
                    isCurrent: rate === currentMarginalRate,
                };
            });

        // Year-by-year plan: fill the current bracket every year until
        // retirement or until the traditional balance is exhausted.
        const conversionSchedule = [];
        let remaining = traditionalIraBalance;
        const currentYear = new Date().getFullYear();
        if (shouldConvert) {
            for (let age = currentAge; age < retirementAge && remaining > 0; age++) {
                const convertAmount = Math.round(Math.min(bracketHeadroom, remaining));
                if (convertAmount <= 0) break;
                conversionSchedule.push({
                    year: currentYear + (age - currentAge),
                    age,
                    convertAmount,
                    taxCost: Math.round(convertAmount * currentMarginalRate / 100),
                    bracketUsed: `${currentMarginalRate}%`,
                });
                remaining = (remaining - convertAmount) * (1 + IRA_GROWTH_RATE);
            }
        }

        return res.json({
            currentIncome,
            filingStatus: status,
            traditionalIraBalance: Math.round(traditionalIraBalance),
            rothIraBalance: Math.round(rothIraBalance),
            currentMarginalRate,
            retirementMarginalRate,
            shouldConvert,
            reason,
            optimalConversionAmount,
            taxCostNow,
            taxCostIfWait,
            taxSavings,
            brackets,
            conversionSchedule,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Roth conversion analysis failed' });
    }
});

// ─── GET /api/tax/irmaa ──────────────────────────────────────────────────────

router.get('/irmaa', requireAuth, async (req, res) => {
    try {
        const status = filingStatusOf(req);
        const projectedIncome = num(req.query.projectedIncome, 0);
        const tiers = IRMAA_TIERS[status];

        const currentTierIdx = tiers.findIndex((t) => projectedIncome <= t.threshold);
        const currentTier = tiers[currentTierIdx];
        const nextTier = tiers[currentTierIdx + 1] || null;

        const currentPremium = IRMAA_BASE_PREMIUM + currentTier.surcharge;
        const distanceToNextTier = Number.isFinite(currentTier.threshold)
            ? Math.max(0, currentTier.threshold - projectedIncome) + 1
            : null;

        let warning = null;
        if (nextTier && distanceToNextTier !== null && distanceToNextTier <= 30000) {
            const extraMonthly = (nextTier.surcharge - currentTier.surcharge).toFixed(2);
            warning = `Warning: You are ${formatUsd(distanceToNextTier)} from the next IRMAA tier. `
                + `A Roth conversion of more than this amount could trigger an extra $${extraMonthly}/mo `
                + `in Medicare premiums.`;
        }

        return res.json({
            projectedIncome,
            filingStatus: status,
            currentTier: currentTier.tier,
            currentPremium,
            currentAnnualCost: Math.round(currentPremium * 12 * 100) / 100,
            distanceToNextTier,
            warning,
            rothConversionSafeAmount: distanceToNextTier === null ? 0 : Math.max(0, distanceToNextTier - 1),
            tiers: tiers.map((t, i) => ({
                tier: t.tier,
                threshold: Number.isFinite(t.threshold) ? t.threshold : null,
                premium: Math.round((IRMAA_BASE_PREMIUM + t.surcharge) * 100) / 100,
                annualCost: Math.round((IRMAA_BASE_PREMIUM + t.surcharge) * 12),
                surcharge: t.surcharge,
                status: i === currentTierIdx ? 'current' : i === currentTierIdx + 1 ? 'next' : i < currentTierIdx ? 'below' : 'above',
                // current tier: negative buffer to its top; higher tiers: income needed to enter
                distanceFrom: i === currentTierIdx
                    ? (Number.isFinite(t.threshold) ? projectedIncome - t.threshold : null)
                    : i > currentTierIdx
                        ? (Number.isFinite(tiers[i - 1].threshold) ? tiers[i - 1].threshold - projectedIncome + 1 : null)
                        : null,
            })),
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'IRMAA analysis failed' });
    }
});

function formatUsd(v) {
    return `$${Math.round(v).toLocaleString('en-US')}`;
}

// ─── GET /api/tax/social-security ────────────────────────────────────────────

// Taxable portion of Social Security under the combined-income rules
function taxableSSPortion(annualSS, otherIncome, status) {
    const base = status === 'married' ? 32000 : 25000;
    const upper = status === 'married' ? 44000 : 34000;
    const combined = otherIncome + annualSS / 2;

    if (combined <= base) return 0;
    if (combined <= upper) {
        return Math.min(annualSS * 0.5, (combined - base) * 0.5);
    }
    return Math.min(
        annualSS * 0.85,
        (combined - upper) * 0.85 + Math.min(annualSS * 0.5, (upper - base) * 0.5)
    );
}

router.get('/social-security', requireAuth, async (req, res) => {
    try {
        const status = filingStatusOf(req);
        const monthlyBenefitAt62 = num(req.query.monthlyBenefitAt62, 2800);
        const currentAge = num(req.query.currentAge, 62);
        const otherIncome = num(req.query.otherIncome, 0);
        const lifeExpectancy = num(req.query.lifeExpectancy, 90);

        const fraMonthly = monthlyBenefitAt62 / 0.70;
        const currentYear = new Date().getFullYear();

        const monthlyAt = (age) => Math.round(fraMonthly * SS_PCT_BY_AGE[age] / 100);
        const lifetimeAt = (age) => monthlyAt(age) * 12 * Math.max(0, lifeExpectancy - age);

        // Age at which delaying to `laterAge` overtakes claiming at `earlyAge`
        function breakEven(earlyAge, laterAge) {
            const mEarly = monthlyAt(earlyAge);
            const mLater = monthlyAt(laterAge);
            if (mLater <= mEarly) return null;
            const x = (mLater * laterAge - mEarly * earlyAge) / (mLater - mEarly);
            const age = Math.ceil(x);
            return age > lifeExpectancy ? null : age;
        }

        const claimingOptions = [];
        for (let age = 62; age <= 70; age++) {
            const monthly = monthlyAt(age);
            const annualSS = monthly * 12;
            const taxable = taxableSSPortion(annualSS, otherIncome, status);
            const rate = marginalRate(otherIncome + taxable, status);
            const annualTax = taxable * rate / 100;
            claimingOptions.push({
                age,
                monthly,
                pct: SS_PCT_BY_AGE[age],
                lifetimeTotal: lifetimeAt(age),
                breakEvenVs62: age === 62 ? null : breakEven(62, age),
                afterTaxMonthly: Math.round(monthly - annualTax / 12),
                taxableAmount: Math.round(taxable),
            });
        }

        const optimal = claimingOptions.reduce((best, o) => (o.lifetimeTotal > best.lifetimeTotal ? o : best));
        const be62 = optimal.age === 62 ? null : breakEven(62, optimal.age);
        const be67 = optimal.age === 67 ? null : breakEven(Math.min(67, optimal.age), Math.max(67, optimal.age));

        const recommendation = optimal.age === 62
            ? `With a life expectancy of ${lifeExpectancy}, claiming at 62 maximizes your lifetime benefits.`
            : `Delaying to age ${optimal.age} maximizes lifetime benefits if you live past age ${be62 ?? '—'}. `
              + `Your break-even point vs claiming at 62 is age ${be62 ?? '—'}.`;

        const taxableNow = taxableSSPortion(monthlyAt(Math.max(62, Math.min(70, currentAge))) * 12, otherIncome, status);

        return res.json({
            monthlyBenefitAt62,
            fraMonthlyBenefit: Math.round(fraMonthly),
            filingStatus: status,
            lifeExpectancy,
            optimalAge: optimal.age,
            optimalMonthlyBenefit: optimal.monthly,
            breakEvenVs62: be62 ? { age: be62, year: currentYear + (be62 - currentAge) } : null,
            breakEvenVs67: be67 ? { age: be67, year: currentYear + (be67 - currentAge) } : null,
            claimingOptions,
            recommendation,
            taxableAmount: Math.round(taxableNow),
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Social Security analysis failed' });
    }
});

export default router;
