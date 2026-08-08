import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { requireProfile, writeProfileId } from '../middleware/profile.js';
import { query } from '../db/client.js';

const router = Router();

const PROPERTY_TYPES = ['residential', 'commercial', 'land', 'other'];

const PROPERTY_COLUMNS = `
    id, name, property_type, address, estimated_value, purchase_price,
    purchase_date, mortgage_balance, mortgage_payment, mortgage_rate,
    mortgage_maturity_date, rental_income, rental_frequency, notes,
    is_primary_residence, ownership_pct, commission_rate, sale_costs,
    include_in_calculations, include_in_cash_flow, archived_at, created_at, updated_at`;

function annualRentalIncome(property) {
    const rental = Number(property.rental_income) || 0;
    return property.rental_frequency === 'annual' ? rental : rental * 12;
}

function withComputed(row) {
    const ownershipPct = Number(row.ownership_pct ?? 100);
    const ownershipFrac = ownershipPct / 100;
    const fullValue = Number(row.estimated_value);
    const fullMortgage = Number(row.mortgage_balance) || 0;
    const yourValue = fullValue * ownershipFrac;
    const yourMortgage = fullMortgage * ownershipFrac;
    const yourEquity = yourValue - yourMortgage;
    const commissionRate = Number(row.commission_rate ?? 6);
    const commissionAmount = yourValue * (commissionRate / 100);
    const saleCosts = Number(row.sale_costs) || 0;
    const netEquityIfSold = yourEquity - commissionAmount - saleCosts;

    return {
        ...row,
        // legacy key — kept so existing callers don't break
        equity: yourEquity,
        // ownership-aware keys
        yourValue,
        yourMortgage,
        yourEquity,
        commissionAmount,
        netEquityIfSold,
        annual_rental_income: annualRentalIncome(row),
    };
}

function validatePropertyInput(body, { partial = false } = {}) {
    const { name, property_type, estimated_value } = body;
    if (!partial || name !== undefined) {
        if (!name || !String(name).trim()) {
            return 'name is required';
        }
    }
    if (property_type !== undefined && !PROPERTY_TYPES.includes(property_type)) {
        return `property_type must be one of: ${PROPERTY_TYPES.join(', ')}`;
    }
    if (!partial || estimated_value !== undefined) {
        if (!Number.isFinite(Number(estimated_value)) || Number(estimated_value) < 0) {
            return 'estimated_value must be a non-negative number';
        }
    }
    return null;
}

// Record a valuation point; one per property per day (re-recording replaces it)
async function recordValue(propertyId, estimatedValue, recordedDate, source, notes) {
    await query(
        `INSERT INTO property_values (property_id, estimated_value, recorded_date, source, notes)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5)
         ON CONFLICT (property_id, recorded_date)
         DO UPDATE SET estimated_value = EXCLUDED.estimated_value,
                       source = EXCLUDED.source,
                       notes = EXCLUDED.notes`,
        [propertyId, estimatedValue, recordedDate || null, source, notes?.trim() || null]
    );
}

router.get('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const result = await query(
            `SELECT ${PROPERTY_COLUMNS}
             FROM properties
             WHERE user_id = $1
               AND ($2::int IS NULL OR profile_id = $2)
             ORDER BY is_primary_residence DESC, created_at`,
            [req.user.id, req.profileId]
        );

        const properties = result.rows.map(withComputed);
        const active   = properties.filter((p) => !p.archived_at);
        const included = active.filter((p) => p.include_in_calculations !== false);

        return res.json({
            properties,
            totals: {
                total_real_estate_value: included.reduce((s, p) => s + Number(p.estimated_value), 0),
                total_your_value: included.reduce((s, p) => s + p.yourValue, 0),
                total_mortgage_balance: included.reduce((s, p) => s + (Number(p.mortgage_balance) || 0), 0),
                total_equity: included.reduce((s, p) => s + p.yourEquity, 0),
                total_net_equity_if_sold: included.reduce((s, p) => s + p.netEquityIfSold, 0),
                total_monthly_rental_income: included.reduce((s, p) => s + p.annual_rental_income / 12, 0),
                total_annual_rental_income: included.reduce((s, p) => s + p.annual_rental_income, 0),
            },
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load properties' });
    }
});

router.post('/', requireAuth, requireProfile, async (req, res) => {
    try {
        const body = req.body || {};
        const invalid = validatePropertyInput(body);
        if (invalid) {
            return res.status(400).json({ error: invalid });
        }

        const created = await query(
            `INSERT INTO properties
                 (user_id, profile_id, name, property_type, address, estimated_value, purchase_price,
                  purchase_date, mortgage_balance, mortgage_payment, mortgage_rate,
                  mortgage_maturity_date, rental_income, rental_frequency, notes,
                  is_primary_residence, ownership_pct, commission_rate, sale_costs)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
             RETURNING ${PROPERTY_COLUMNS}`,
            [
                req.user.id,
                writeProfileId(req),
                String(body.name).trim(),
                PROPERTY_TYPES.includes(body.property_type) ? body.property_type : 'residential',
                body.address?.trim() || null,
                Number(body.estimated_value) || 0,
                Number.isFinite(Number(body.purchase_price)) && body.purchase_price !== '' && body.purchase_price !== null ? Number(body.purchase_price) : null,
                body.purchase_date || null,
                Number(body.mortgage_balance) || 0,
                Number(body.mortgage_payment) || 0,
                Number.isFinite(Number(body.mortgage_rate)) && body.mortgage_rate !== '' && body.mortgage_rate !== null && body.mortgage_rate !== undefined ? Number(body.mortgage_rate) : null,
                body.mortgage_maturity_date || null,
                Number(body.rental_income) || 0,
                body.rental_frequency === 'annual' ? 'annual' : 'monthly',
                body.notes?.trim() || null,
                body.is_primary_residence === true,
                body.ownership_pct != null && body.ownership_pct !== '' ? Number(body.ownership_pct) : 100,
                body.commission_rate != null && body.commission_rate !== '' ? Number(body.commission_rate) : 6,
                Number(body.sale_costs) || 0,
            ]
        );

        const property = created.rows[0];
        // Seed the valuation history with the initial value
        await recordValue(property.id, Number(body.estimated_value) || 0, null, 'initial', null);

        return res.status(201).json(withComputed(property));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to create property' });
    }
});

router.put('/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const body = req.body || {};
        const invalid = validatePropertyInput(body, { partial: true });
        if (invalid) {
            return res.status(400).json({ error: invalid });
        }

        const existing = await query(
            `SELECT id, estimated_value FROM properties WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!existing.rowCount) {
            return res.status(404).json({ error: 'Property not found' });
        }

        const updated = await query(
            `UPDATE properties
             SET name = COALESCE($3, name),
                 property_type = COALESCE($4, property_type),
                 address = CASE WHEN $5 THEN $6 ELSE address END,
                 estimated_value = COALESCE($7, estimated_value),
                 purchase_price = CASE WHEN $8 THEN $9 ELSE purchase_price END,
                 purchase_date = CASE WHEN $10 THEN $11::date ELSE purchase_date END,
                 mortgage_balance = COALESCE($12, mortgage_balance),
                 mortgage_payment = COALESCE($13, mortgage_payment),
                 mortgage_rate = CASE WHEN $14 THEN $15 ELSE mortgage_rate END,
                 mortgage_maturity_date = CASE WHEN $16 THEN $17::date ELSE mortgage_maturity_date END,
                 rental_income = COALESCE($18, rental_income),
                 rental_frequency = COALESCE($19, rental_frequency),
                 notes = CASE WHEN $20 THEN $21 ELSE notes END,
                 is_primary_residence = COALESCE($22, is_primary_residence),
                 ownership_pct = COALESCE($23, ownership_pct),
                 commission_rate = COALESCE($24, commission_rate),
                 sale_costs = COALESCE($25, sale_costs),
                 updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING ${PROPERTY_COLUMNS}`,
            [
                req.params.id,
                req.user.id,
                body.name !== undefined ? String(body.name).trim() : null,
                body.property_type ?? null,
                body.address !== undefined,
                body.address !== undefined ? (body.address?.trim() || null) : null,
                body.estimated_value !== undefined ? Number(body.estimated_value) : null,
                body.purchase_price !== undefined,
                body.purchase_price !== undefined && body.purchase_price !== null && body.purchase_price !== '' ? Number(body.purchase_price) : null,
                body.purchase_date !== undefined,
                body.purchase_date || null,
                body.mortgage_balance !== undefined ? Number(body.mortgage_balance) || 0 : null,
                body.mortgage_payment !== undefined ? Number(body.mortgage_payment) || 0 : null,
                body.mortgage_rate !== undefined,
                body.mortgage_rate !== undefined && body.mortgage_rate !== null && body.mortgage_rate !== '' ? Number(body.mortgage_rate) : null,
                body.mortgage_maturity_date !== undefined,
                body.mortgage_maturity_date || null,
                body.rental_income !== undefined ? Number(body.rental_income) || 0 : null,
                body.rental_frequency !== undefined ? (body.rental_frequency === 'annual' ? 'annual' : 'monthly') : null,
                body.notes !== undefined,
                body.notes !== undefined ? (body.notes?.trim() || null) : null,
                typeof body.is_primary_residence === 'boolean' ? body.is_primary_residence : null,
                body.ownership_pct !== undefined ? Number(body.ownership_pct) : null,
                body.commission_rate !== undefined ? Number(body.commission_rate) : null,
                body.sale_costs !== undefined ? Number(body.sale_costs) || 0 : null,
            ]
        );

        const property = updated.rows[0];

        // Value changed via edit → append to valuation history
        if (
            body.estimated_value !== undefined &&
            Number(body.estimated_value) !== Number(existing.rows[0].estimated_value)
        ) {
            await recordValue(property.id, Number(body.estimated_value), null, 'manual', null);
        }

        return res.json(withComputed(property));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update property' });
    }
});

// Soft delete — archived properties drop out of totals but keep history
router.delete('/:id', requireAuth, requireProfile, async (req, res) => {
    try {
        const archived = await query(
            `UPDATE properties SET archived_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
             RETURNING id`,
            [req.params.id, req.user.id]
        );

        if (!archived.rowCount) {
            return res.status(404).json({ error: 'Property not found' });
        }

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to archive property' });
    }
});

router.post('/:id/value-update', requireAuth, requireProfile, async (req, res) => {
    try {
        const { estimated_value, recorded_date, notes } = req.body || {};

        if (!Number.isFinite(Number(estimated_value)) || Number(estimated_value) < 0) {
            return res.status(400).json({ error: 'estimated_value must be a non-negative number' });
        }

        const updated = await query(
            `UPDATE properties
             SET estimated_value = $3, updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING ${PROPERTY_COLUMNS}`,
            [req.params.id, req.user.id, Number(estimated_value)]
        );

        if (!updated.rowCount) {
            return res.status(404).json({ error: 'Property not found' });
        }

        await recordValue(req.params.id, Number(estimated_value), recorded_date, 'manual', notes);

        return res.json(withComputed(updated.rows[0]));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to record value' });
    }
});

// PATCH /api/properties/:id/toggle — flip a boolean include flag
//
// New API:    { field: 'include_in_net_worth' | 'include_in_cash_flow', value: boolean }
// Legacy API: { included: boolean }  → maps to include_in_calculations (net worth)
const TOGGLE_FIELD_MAP = {
    include_in_net_worth: 'include_in_calculations',
    include_in_cash_flow: 'include_in_cash_flow',
};

router.patch('/:id/toggle', requireAuth, requireProfile, async (req, res) => {
    try {
        const { included, field, value } = req.body ?? {};

        let column, boolValue;
        if (field !== undefined) {
            column = TOGGLE_FIELD_MAP[field];
            if (!column) {
                return res.status(400).json({
                    error: `field must be one of: ${Object.keys(TOGGLE_FIELD_MAP).join(', ')}`,
                });
            }
            if (typeof value !== 'boolean') {
                return res.status(400).json({ error: 'value must be a boolean' });
            }
            boolValue = value;
        } else {
            // Legacy path — { included: boolean } → include_in_calculations
            if (typeof included !== 'boolean') {
                return res.status(400).json({ error: 'included must be a boolean' });
            }
            column   = 'include_in_calculations';
            boolValue = included;
        }

        const updated = await query(
            `UPDATE properties
             SET ${column} = $3, updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING ${PROPERTY_COLUMNS}`,
            [req.params.id, req.user.id, boolValue]
        );
        if (!updated.rowCount) {
            return res.status(404).json({ error: 'Property not found' });
        }
        return res.json(withComputed(updated.rows[0]));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update property' });
    }
});

router.get('/:id/history', requireAuth, requireProfile, async (req, res) => {
    try {
        const owner = await query(
            `SELECT id, purchase_price, purchase_date FROM properties WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (!owner.rowCount) {
            return res.status(404).json({ error: 'Property not found' });
        }

        const history = await query(
            `SELECT id, estimated_value, recorded_date, source, notes, created_at
             FROM property_values
             WHERE property_id = $1
             ORDER BY recorded_date`,
            [req.params.id]
        );

        return res.json({
            purchase_price: owner.rows[0].purchase_price,
            purchase_date: owner.rows[0].purchase_date,
            history: history.rows,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load history' });
    }
});

export default router;
