import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { query } from '../db/client.js';

const router = Router();

const EVENT_TYPES = ['dividend', 'interest', 'rental', 'capital_gain', 'other'];
const TAX_TREATMENTS = ['taxable', 'tax_deferred', 'tax_free'];

router.get('/', requireAuth, async (req, res) => {
    try {
        const conditions = ['ie.user_id = $1'];
        const params = [req.user.id];

        if (req.query.year) {
            params.push(Number(req.query.year));
            conditions.push(`EXTRACT(YEAR FROM ie.event_date) = $${params.length}`);
        }
        if (req.query.type && EVENT_TYPES.includes(req.query.type)) {
            params.push(req.query.type);
            conditions.push(`ie.event_type = $${params.length}`);
        }
        if (req.query.accountId) {
            params.push(req.query.accountId);
            conditions.push(`ie.account_id = $${params.length}`);
        }

        const result = await query(
            `SELECT ie.id, ie.account_id, ie.event_type, ie.amount, ie.symbol,
                    ie.description, ie.event_date::text AS event_date, ie.tax_treatment,
                    ie.source, ie.created_at,
                    COALESCE(a.display_name, a.name) AS account_name
             FROM income_events ie
             LEFT JOIN accounts a ON a.id = ie.account_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY ie.event_date DESC, ie.created_at DESC
             LIMIT 500`,
            params
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load income events' });
    }
});

router.post('/', requireAuth, async (req, res) => {
    try {
        const { account_id, event_type, amount, symbol, description, event_date, tax_treatment } = req.body || {};

        if (!EVENT_TYPES.includes(event_type)) {
            return res.status(400).json({ error: `event_type must be one of: ${EVENT_TYPES.join(', ')}` });
        }
        if (!Number.isFinite(Number(amount)) || Number(amount) === 0) {
            return res.status(400).json({ error: 'amount must be a non-zero number' });
        }
        if (!event_date) {
            return res.status(400).json({ error: 'event_date is required' });
        }

        // Account must belong to the user when provided
        if (account_id) {
            const owner = await query(
                `SELECT id FROM accounts WHERE id = $1 AND user_id = $2`,
                [account_id, req.user.id]
            );
            if (!owner.rowCount) {
                return res.status(400).json({ error: 'Account not found' });
            }
        }

        const created = await query(
            `INSERT INTO income_events
                 (user_id, account_id, event_type, amount, symbol, description, event_date, tax_treatment)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, account_id, event_type, amount, symbol, description,
                       event_date::text AS event_date, tax_treatment, source, created_at`,
            [
                req.user.id,
                account_id || null,
                event_type,
                Number(amount),
                symbol?.trim()?.toUpperCase() || null,
                description?.trim() || null,
                event_date,
                TAX_TREATMENTS.includes(tax_treatment) ? tax_treatment : 'taxable',
            ]
        );
        return res.status(201).json(created.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to add income event' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await query(
            `DELETE FROM income_events WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id]
        );
        if (!deleted.rowCount) {
            return res.status(404).json({ error: 'Income event not found' });
        }
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to delete income event' });
    }
});

function summarize(rows) {
    const byType = {};
    const byTaxTreatment = {};
    const byMonthMap = new Map();
    let total = 0;

    for (const r of rows) {
        const amt = Number(r.amount);
        total += amt;
        byType[r.event_type] = (byType[r.event_type] || 0) + amt;
        byTaxTreatment[r.tax_treatment] = (byTaxTreatment[r.tax_treatment] || 0) + amt;
        const month = r.event_date.slice(0, 7);
        if (!byMonthMap.has(month)) byMonthMap.set(month, { month, total: 0 });
        const m = byMonthMap.get(month);
        m.total += amt;
        m[r.event_type] = (m[r.event_type] || 0) + amt;
    }

    return {
        total: Math.round(total * 100) / 100,
        byType,
        byTaxTreatment,
        byMonth: [...byMonthMap.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    };
}

router.get('/summary', requireAuth, async (req, res) => {
    try {
        const now = new Date();
        const thisYear = now.getFullYear();

        const [eventsResult, byAccountResult] = await Promise.all([
            query(
                `SELECT ie.event_type, ie.amount, ie.event_date::text AS event_date, ie.tax_treatment
                 FROM income_events ie
                 WHERE ie.user_id = $1
                   AND EXTRACT(YEAR FROM ie.event_date) >= $2`,
                [req.user.id, thisYear - 1]
            ),
            query(
                `SELECT COALESCE(COALESCE(a.display_name, a.name), '(no account)') AS account_name,
                        a.type AS account_type,
                        ie.tax_treatment,
                        SUM(ie.amount) AS ytd_total
                 FROM income_events ie
                 LEFT JOIN accounts a ON a.id = ie.account_id
                 WHERE ie.user_id = $1
                   AND EXTRACT(YEAR FROM ie.event_date) = $2
                 GROUP BY 1, 2, 3
                 ORDER BY ytd_total DESC`,
                [req.user.id, thisYear]
            ),
        ]);

        const ytdRows = eventsResult.rows.filter((r) => r.event_date.startsWith(String(thisYear)));
        const lastYearRows = eventsResult.rows.filter((r) => r.event_date.startsWith(String(thisYear - 1)));
        // Trailing 12 months for the "Last 12 Mo" card
        const cutoff = new Date(now);
        cutoff.setFullYear(cutoff.getFullYear() - 1);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        const trailingRows = eventsResult.rows.filter((r) => r.event_date >= cutoffStr);

        const ytd = summarize(ytdRows);
        const lastYear = summarize(lastYearRows);
        const trailing12 = summarize(trailingRows);

        // Annualize YTD by elapsed days
        const dayOfYear = Math.floor((now - new Date(thisYear, 0, 1)) / 86_400_000) + 1;
        const projectedAnnual = dayOfYear > 0 ? (ytd.total / dayOfYear) * 365 : 0;

        return res.json({
            ytd,
            lastYear,
            trailing12: { total: trailing12.total },
            projected: {
                annual: Math.round(projectedAnnual * 100) / 100,
                monthly: Math.round((projectedAnnual / 12) * 100) / 100,
            },
            byAccount: byAccountResult.rows.map((r) => ({
                accountName: r.account_name,
                accountType: r.account_type,
                taxTreatment: r.tax_treatment,
                ytdTotal: Number(r.ytd_total),
            })),
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load income summary' });
    }
});

export default router;
