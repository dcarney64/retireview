import { query } from '../db/client.js';
import { computeProjection } from '../routes/scenarios.js';
import { sendHtmlEmail } from './emailService.js';

const IRMAA_SINGLE_FIRST_TIER = 106000; // 2026 single-filer threshold

function usd(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(Number(value) || 0);
}

function changeBadge(delta) {
    if (delta == null) return '';
    const color = delta >= 0 ? '#199e70' : '#dc2626';
    const arrow = delta >= 0 ? '▲' : '▼';
    return `<span style="color:${color};">${arrow} ${usd(Math.abs(delta))}</span>`;
}

/**
 * Gathers a user's weekly numbers and renders the digest email.
 * Returns { subject, html, data } — data is exposed for tests/preview.
 */
export async function generateDigest(userId) {
    const [userResult, accountsResult, propertiesResult, snapshotsResult, scenarioResult] =
        await Promise.all([
            query(`SELECT email, full_name FROM users WHERE id = $1`, [userId]),
            query(
                `SELECT COALESCE(display_name, name) AS name, type, balance
                 FROM accounts
                 WHERE user_id = $1 AND archived_at IS NULL AND include_in_tracking = true
                 ORDER BY balance DESC`,
                [userId]
            ),
            query(
                `SELECT COALESCE(SUM(estimated_value), 0) AS value,
                        COALESCE(SUM(mortgage_balance), 0) AS mortgage
                 FROM properties
                 WHERE user_id = $1 AND archived_at IS NULL`,
                [userId]
            ),
            query(
                `SELECT total, snapped_at::text AS snapped_at
                 FROM snapshots
                 WHERE user_id = $1
                 ORDER BY snapped_at DESC
                 LIMIT 60`,
                [userId]
            ),
            query(
                `SELECT * FROM retirement_scenarios
                 WHERE user_id = $1 AND is_active = true
                 LIMIT 1`,
                [userId]
            ),
        ]);

    const user = userResult.rows[0];
    if (!user) throw new Error('User not found');

    const accounts = accountsResult.rows;
    const liquidTotal = accounts.reduce((s, a) => s + Number(a.balance), 0);
    const reEquity = Number(propertiesResult.rows[0].value) - Number(propertiesResult.rows[0].mortgage);
    const netWorth = liquidTotal + reEquity;

    // Week-over-week: latest snapshot vs the last one at least 6 days older
    const snapshots = snapshotsResult.rows;
    let weekChange = null;
    if (snapshots.length >= 2) {
        const latest = snapshots[0];
        const weekAgo = snapshots.find(
            (s) => (new Date(latest.snapped_at) - new Date(s.snapped_at)) / 86_400_000 >= 6
        );
        if (weekAgo) weekChange = Number(latest.total) - Number(weekAgo.total);
    }

    // YTD from snapshots: first snapshot of this year vs latest
    const year = String(new Date().getFullYear());
    const thisYearSnaps = snapshots.filter((s) => s.snapped_at.startsWith(year));
    let ytdPct = null;
    if (thisYearSnaps.length >= 2) {
        const first = Number(thisYearSnaps[thisYearSnaps.length - 1].total);
        const last = Number(thisYearSnaps[0].total);
        if (first > 0) ytdPct = ((last - first) / first) * 100;
    }

    // Active scenario: monthly income estimate + goal progress
    const scenario = scenarioResult.rows[0] || null;
    let monthlyIncome = null;
    let goalPct = null;
    let annualIncome = null;
    let scenarioName = null;
    if (scenario) {
        scenarioName = scenario.name;
        const scenarioWithPortfolio = {
            ...scenario,
            starting_portfolio: scenario.starting_portfolio ?? liquidTotal,
        };
        const projection = computeProjection(scenarioWithPortfolio, new Date().getFullYear());
        monthlyIncome = projection.summary.monthlyIncomeAtRetirement;
        annualIncome = monthlyIncome * 12;
        const target = projection.summary.portfolioAtRetirement;
        if (target > 0) goalPct = Math.min(100, (liquidTotal / target) * 100);
    }

    // IRMAA heads-up (single-filer threshold; informational only)
    let irmaaWarning = null;
    if (annualIncome && annualIncome > IRMAA_SINGLE_FIRST_TIER - 30000 && annualIncome <= IRMAA_SINGLE_FIRST_TIER) {
        irmaaWarning = `Your projected retirement income (${usd(annualIncome)}/yr) is within `
            + `${usd(IRMAA_SINGLE_FIRST_TIER - annualIncome)} of the first Medicare IRMAA tier (${usd(IRMAA_SINGLE_FIRST_TIER)}).`;
    } else if (annualIncome && annualIncome > IRMAA_SINGLE_FIRST_TIER) {
        irmaaWarning = `Your projected retirement income (${usd(annualIncome)}/yr) exceeds the first Medicare `
            + `IRMAA tier (${usd(IRMAA_SINGLE_FIRST_TIER)}) — expect higher Medicare premiums.`;
    }

    const accountRows = accounts.map((a) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#334155;">${a.name}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;color:#0f172a;">${usd(a.balance)}</td>
        </tr>`).join('');

    const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color:#0f172a;margin-bottom:4px;">RetireView Weekly Summary</h2>
      <p style="color:#64748b;margin-top:0;">Hi ${user.full_name || user.email},</p>

      <div style="background:#f1f5f9;border-radius:12px;padding:20px;margin:16px 0;">
        <div style="color:#64748b;font-size:14px;">Total Net Worth</div>
        <div style="font-size:32px;font-weight:700;color:#0f172a;">${usd(netWorth)}</div>
        ${weekChange != null ? `<div style="font-size:14px;margin-top:4px;">${changeBadge(weekChange)} this week</div>` : ''}
        <div style="color:#64748b;font-size:13px;margin-top:8px;">
          ${usd(liquidTotal)} liquid${reEquity > 0 ? ` + ${usd(reEquity)} real estate equity` : ''}
        </div>
      </div>

      <h3 style="color:#0f172a;margin-bottom:8px;">Accounts</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${accountRows}</table>

      <div style="margin:20px 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:14px;color:#334155;">
        ${ytdPct != null ? `<p>YTD performance: <strong>${ytdPct >= 0 ? '+' : ''}${ytdPct.toFixed(1)}%</strong></p>` : ''}
        ${goalPct != null ? `<p>Retirement goal progress: <strong>${goalPct.toFixed(1)}%</strong> of your ${scenarioName} scenario target</p>` : ''}
        ${monthlyIncome != null ? `<p>Estimated retirement income: <strong>${usd(monthlyIncome)}/mo</strong> (${scenarioName} scenario)</p>` : ''}
        ${irmaaWarning ? `<p style="color:#b45309;">⚠ ${irmaaWarning}</p>` : ''}
      </div>

      <p style="color:#94a3b8;font-size:12px;">
        You're receiving this because weekly digests are enabled in your RetireView settings.
      </p>
    </div>`;

    return {
        subject: `RetireView Weekly Summary — ${usd(netWorth)}`,
        html,
        data: { netWorth, liquidTotal, reEquity, weekChange, ytdPct, goalPct, monthlyIncome, irmaaWarning },
    };
}

export async function sendWeeklyDigest(userId) {
    const digest = await generateDigest(userId);
    const userResult = await query(`SELECT email FROM users WHERE id = $1`, [userId]);
    const email = userResult.rows[0]?.email;
    if (!email) throw new Error('User email not found');

    const result = await sendHtmlEmail(email, digest.subject, digest.html);
    return { ...result, subject: digest.subject };
}
