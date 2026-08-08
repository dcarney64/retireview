import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { requireProfile } from '../middleware/profile.js';
import { query } from '../db/client.js';

const router = Router();

// ─── Core helper ─────────────────────────────────────────────────────────────

/**
 * Compute setup status for a specific profile.
 * Returns null if the profile doesn't exist / doesn't belong to userId.
 */
async function buildStatus(userId, profileId) {
    const [
        profileResult,
        accountsResult,
        propertiesResult,
        otherAssetsResult,
        incomeResult,
        expensesResult,
        scenariosResult,
        profilesCountResult,
    ] = await Promise.all([
        query(
            `SELECT id, name FROM profiles WHERE id = $1 AND user_id = $2`,
            [profileId, userId],
        ),
        query(
            `SELECT COUNT(*) AS count FROM accounts
             WHERE user_id = $1 AND profile_id = $2 AND archived_at IS NULL`,
            [userId, profileId],
        ),
        query(
            `SELECT COUNT(*) AS count FROM properties
             WHERE user_id = $1 AND profile_id = $2 AND archived_at IS NULL`,
            [userId, profileId],
        ),
        query(
            `SELECT COUNT(*) AS count FROM other_assets
             WHERE user_id = $1 AND profile_id = $2 AND archived_at IS NULL`,
            [userId, profileId],
        ),
        query(
            `SELECT COUNT(*) AS count FROM recurring_income
             WHERE user_id = $1 AND profile_id = $2 AND is_active = true`,
            [userId, profileId],
        ),
        query(
            `SELECT COUNT(*) AS count FROM monthly_expenses
             WHERE user_id = $1 AND profile_id = $2`,
            [userId, profileId],
        ),
        query(
            `SELECT id, retirement_age, annual_spending_goal
             FROM retirement_scenarios
             WHERE user_id = $1 AND profile_id = $2
             ORDER BY is_active DESC, created_at ASC
             LIMIT 1`,
            [userId, profileId],
        ),
        query(
            `SELECT COUNT(*) AS count FROM profiles WHERE user_id = $1`,
            [userId],
        ),
    ]);

    if (!profileResult.rowCount) return null;

    const profile          = profileResult.rows[0];
    const accountsCount    = Number(accountsResult.rows[0].count);
    const propertiesCount  = Number(propertiesResult.rows[0].count);
    const otherAssetsCount = Number(otherAssetsResult.rows[0].count);
    const incomeCount      = Number(incomeResult.rows[0].count);
    const expensesCount    = Number(expensesResult.rows[0].count);
    const profilesCount    = Number(profilesCountResult.rows[0].count);

    // Retirement goal: empty → partial → complete
    const scenario = scenariosResult.rows[0] || null;
    let retirementStatus;
    let retirementCountLabel;
    if (!scenario) {
        retirementStatus     = 'empty';
        retirementCountLabel = 'No scenario created yet';
    } else if (!scenario.annual_spending_goal || Number(scenario.annual_spending_goal) === 0) {
        retirementStatus     = 'partial';
        retirementCountLabel = 'Scenario set, spending goal not configured';
    } else {
        retirementStatus     = 'complete';
        retirementCountLabel = `Retirement age ${scenario.retirement_age} · spending goal set`;
    }

    const steps = [
        {
            id:              'accounts',
            label:           'Connect your accounts',
            description:     'Link your investment accounts via SnapTrade or add manually',
            status:          accountsCount > 0 ? 'complete' : 'empty',
            count:           accountsCount,
            countLabel:      accountsCount > 0
                ? `${accountsCount} account${accountsCount === 1 ? '' : 's'} connected`
                : 'No accounts added',
            path:            '/accounts',
            required:        false,
            minimumRequired: true,
        },
        {
            id:              'real_estate',
            label:           'Add your properties',
            description:     'Track home equity and rental properties',
            status:          propertiesCount > 0 ? 'complete' : 'empty',
            count:           propertiesCount,
            countLabel:      propertiesCount > 0
                ? `${propertiesCount} propert${propertiesCount === 1 ? 'y' : 'ies'} added`
                : 'No properties added',
            path:            '/real-estate',
            required:        false,
            minimumRequired: true,
        },
        {
            id:              'other_assets',
            label:           'Add other assets',
            description:     'Business interests, IP, vehicles, collectibles',
            status:          otherAssetsCount > 0 ? 'complete' : 'empty',
            count:           otherAssetsCount,
            countLabel:      otherAssetsCount > 0
                ? `${otherAssetsCount} asset${otherAssetsCount === 1 ? '' : 's'} added`
                : 'No assets added',
            path:            '/other-assets',
            required:        false,
            minimumRequired: false,
        },
        {
            id:              'income',
            label:           'Set up income sources',
            description:     'Social Security, pension, employment, rental income',
            status:          incomeCount > 0 ? 'complete' : 'empty',
            count:           incomeCount,
            countLabel:      incomeCount > 0
                ? `${incomeCount} income source${incomeCount === 1 ? '' : 's'} configured`
                : 'No income sources added',
            path:            '/income',
            required:        false,
            minimumRequired: false,
        },
        {
            id:              'expenses',
            label:           'Add monthly expenses',
            description:     'Bills and expenses to track your cash flow',
            status:          expensesCount > 0 ? 'complete' : 'empty',
            count:           expensesCount,
            countLabel:      expensesCount > 0
                ? `${expensesCount} expense${expensesCount === 1 ? '' : 's'} added`
                : 'No expenses added',
            path:            '/cash-flow',
            required:        false,
            minimumRequired: false,
        },
        {
            id:              'retirement_goal',
            label:           'Set your retirement goal',
            description:     'Define your target retirement age and spending goal',
            status:          retirementStatus,
            count:           scenario ? 1 : 0,
            countLabel:      retirementCountLabel,
            path:            '/retirement',
            required:        false,
            minimumRequired: true,
        },
        {
            id:              'household',
            label:           'Add household members',
            description:     "Track spouse or partner's finances alongside yours",
            status:          profilesCount > 1 ? 'complete' : 'empty',
            count:           Math.max(0, profilesCount - 1),
            countLabel:      profilesCount > 1
                ? `${profilesCount - 1} household member${profilesCount - 1 === 1 ? '' : 's'} added`
                : 'No household members added',
            path:            '/settings',
            required:        false,
            minimumRequired: false,
        },
    ];

    const completedSteps = steps.filter((s) => s.status === 'complete').length;
    const overallPct = Math.round((completedSteps / steps.length) * 100);

    // Minimum: (at least 1 account OR 1 property) AND retirement goal is not empty
    const isMinimumComplete =
        (accountsCount > 0 || propertiesCount > 0) && retirementStatus !== 'empty';

    return {
        profileName:       profile.name,
        profileId:         profile.id,
        overallPct,
        isMinimumComplete,
        steps,
    };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/setup/status — setup status for the active profile
router.get('/status', requireAuth, requireProfile, async (req, res) => {
    try {
        const effectiveProfileId = req.profileId ?? req.primaryProfileId;
        const status = await buildStatus(req.user.id, effectiveProfileId);
        if (!status) return res.status(404).json({ error: 'Profile not found' });
        return res.json(status);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to compute setup status' });
    }
});

// GET /api/setup/all-profiles — setup status for all household profiles
// Used by the Getting Started household section — no profile header required.
router.get('/all-profiles', requireAuth, async (req, res) => {
    try {
        const profilesResult = await query(
            `SELECT id FROM profiles WHERE user_id = $1 ORDER BY is_primary DESC, created_at ASC`,
            [req.user.id],
        );
        const statuses = await Promise.all(
            profilesResult.rows.map((p) => buildStatus(req.user.id, p.id)),
        );
        return res.json(statuses.filter(Boolean));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load household status' });
    }
});

export default router;
