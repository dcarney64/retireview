import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Home, LandPlot, Warehouse } from 'lucide-react';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import apiClient from '../api/client';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { formatCurrency } from '../lib/accountTypes';

const RE_GREEN = '#199e70';
const CARD_SURFACE = '#0f172a';

const TYPE_META = {
  residential: { label: 'Residential', Icon: Home },
  commercial: { label: 'Commercial', Icon: Warehouse },
  land: { label: 'Land', Icon: LandPlot },
  other: { label: 'Other', Icon: Building2 },
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function Field({ id, label, children, hint }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-slate-400" htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const EMPTY_FORM = {
  name: '',
  property_type: 'residential',
  is_primary_residence: false,
  address: '',
  estimated_value: '',
  purchase_price: '',
  purchase_date: '',
  mortgage_balance: '',
  mortgage_payment: '',
  mortgage_rate: '',
  mortgage_maturity_date: '',
  rental_income: '',
  notes: '',
};

function PropertyModal({ property, onClose, onSaved }) {
  const [form, setForm] = useState(
    property
      ? {
          name: property.name || '',
          property_type: property.property_type || 'residential',
          is_primary_residence: property.is_primary_residence === true,
          address: property.address || '',
          estimated_value: property.estimated_value != null ? String(Number(property.estimated_value)) : '',
          purchase_price: property.purchase_price != null ? String(Number(property.purchase_price)) : '',
          purchase_date: property.purchase_date ? String(property.purchase_date).slice(0, 10) : '',
          mortgage_balance: property.mortgage_balance != null ? String(Number(property.mortgage_balance)) : '',
          mortgage_payment: property.mortgage_payment != null ? String(Number(property.mortgage_payment)) : '',
          mortgage_rate: property.mortgage_rate != null ? String(Number(property.mortgage_rate)) : '',
          mortgage_maturity_date: property.mortgage_maturity_date ? String(property.mortgage_maturity_date).slice(0, 10) : '',
          rental_income: property.rental_income != null ? String(Number(property.rental_income)) : '',
          notes: property.notes || '',
        }
      : EMPTY_FORM
  );
  const [error, setError] = useState('');

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        property_type: form.property_type,
        is_primary_residence: form.is_primary_residence,
        address: form.address,
        estimated_value: Number(form.estimated_value) || 0,
        purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
        purchase_date: form.purchase_date || null,
        mortgage_balance: Number(form.mortgage_balance) || 0,
        mortgage_payment: Number(form.mortgage_payment) || 0,
        mortgage_rate: form.mortgage_rate === '' ? null : Number(form.mortgage_rate),
        mortgage_maturity_date: form.mortgage_maturity_date || null,
        rental_income: Number(form.rental_income) || 0,
        notes: form.notes,
      };
      if (property) {
        return apiClient.put(`/properties/${property.id}`, payload);
      }
      return apiClient.post('/properties', payload);
    },
    onSuccess: () => onSaved(),
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save property'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold">{property ? 'Edit Property' : 'Add Property'}</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field id="prop-name" label="Property name">
            <Input id="prop-name" value={form.name} onChange={set('name')} placeholder="Primary Residence" />
          </Field>
          <Field id="prop-type" label="Type">
            <select
              id="prop-type"
              value={form.property_type}
              onChange={set('property_type')}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="land">Land</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.is_primary_residence} onChange={set('is_primary_residence')} />
              This is my primary residence
            </label>
          </div>
          <div className="md:col-span-2">
            <Field id="prop-address" label="Address (optional)">
              <Input id="prop-address" value={form.address} onChange={set('address')} />
            </Field>
          </div>
          <Field id="prop-value" label="Estimated current value ($)">
            <Input id="prop-value" type="number" min="0" step="1000" value={form.estimated_value} onChange={set('estimated_value')} />
          </Field>
          <Field id="prop-purchase-price" label="Purchase price ($, optional)">
            <Input id="prop-purchase-price" type="number" min="0" step="1000" value={form.purchase_price} onChange={set('purchase_price')} />
          </Field>
          <Field id="prop-purchase-date" label="Purchase date (optional)">
            <Input id="prop-purchase-date" type="date" value={form.purchase_date} onChange={set('purchase_date')} />
          </Field>
          <Field id="prop-mortgage" label="Mortgage balance ($)">
            <Input id="prop-mortgage" type="number" min="0" step="1000" value={form.mortgage_balance} onChange={set('mortgage_balance')} />
          </Field>
          <Field id="prop-payment" label="Monthly mortgage payment ($, optional)">
            <Input id="prop-payment" type="number" min="0" step="100" value={form.mortgage_payment} onChange={set('mortgage_payment')} />
          </Field>
          <Field id="prop-rate" label="Mortgage interest rate (%, optional)">
            <Input id="prop-rate" type="number" min="0" max="25" step="0.01" value={form.mortgage_rate} onChange={set('mortgage_rate')} />
          </Field>
          <Field id="prop-maturity" label="Mortgage maturity date (optional)">
            <Input id="prop-maturity" type="date" value={form.mortgage_maturity_date} onChange={set('mortgage_maturity_date')} />
          </Field>
          <Field id="prop-rental" label="Rental income ($/month, optional)">
            <Input id="prop-rental" type="number" min="0" step="100" value={form.rental_income} onChange={set('rental_income')} />
          </Field>
          <div className="md:col-span-2">
            <Field id="prop-notes" label="Notes (optional)">
              <Input id="prop-notes" value={form.notes} onChange={set('notes')} />
            </Field>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button className="bg-slate-700 hover:bg-slate-600" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name.trim() || form.estimated_value === ''}
          >
            {saveMutation.isPending ? 'Saving...' : property ? 'Save Changes' : 'Add Property'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UpdateValueModal({ property, onClose, onSaved }) {
  const [value, setValue] = useState(String(Number(property.estimated_value)));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const current = Number(property.estimated_value);
  const next = Number(value) || 0;
  const change = next - current;

  const saveMutation = useMutation({
    mutationFn: async () => apiClient.post(`/properties/${property.id}/value-update`, {
      estimated_value: next,
      recorded_date: date,
      notes: notes || null,
    }),
    onSuccess: () => onSaved(),
    onError: (err) => setError(err?.response?.data?.error || 'Failed to record value'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-semibold">Update Value</h3>
        <p className="mb-4 text-sm text-slate-400">
          {property.name} — currently {formatCurrency(current)}
        </p>

        <div className="space-y-4">
          <Field id="val-new" label="New estimated value ($)">
            <Input id="val-new" type="number" min="0" step="1000" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field id="val-date" label="Date">
            <Input id="val-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="val-notes" label="Notes (optional)">
            <Input id="val-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Zillow estimate" />
          </Field>

          {value !== '' && change !== 0 ? (
            <p className={`text-sm ${change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {change > 0 ? '▲' : '▼'} {formatCurrency(Math.abs(change))}{' '}
              ({current > 0 ? `${((change / current) * 100).toFixed(1)}%` : '—'}) from current value
            </p>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button className="bg-slate-700 hover:bg-slate-600" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || value === ''}>
            {saveMutation.isPending ? 'Saving...' : 'Record Value'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm shadow-lg">
      <div className="mb-1 text-xs text-slate-400">{formatDate(label)}</div>
      <div className="font-medium text-slate-100">{formatCurrency(payload[0].value)}</div>
    </div>
  );
}

function ValueHistoryChart({ propertyId }) {
  const historyQuery = useQuery({
    queryKey: ['property-history', propertyId],
    queryFn: async () => (await apiClient.get(`/properties/${propertyId}/history`)).data,
  });

  if (historyQuery.isLoading) {
    return <p className="py-6 text-center text-sm text-slate-400">Loading history…</p>;
  }
  const data = historyQuery.data;
  const points = (data?.history || []).map((h) => ({
    date: h.recorded_date,
    value: Number(h.estimated_value),
  }));
  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">No value history yet.</p>;
  }
  const purchasePrice = data?.purchase_price != null ? Number(data.purchase_price) : null;

  return (
    <div className="mt-4 h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={{ stroke: '#334155' }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={(v) => formatCurrency(v, { compact: true })}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={70}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#475569', strokeWidth: 1 }} />
          {purchasePrice != null ? (
            <ReferenceLine
              y={purchasePrice}
              stroke="#64748b"
              strokeDasharray="4 4"
              label={{ value: `Purchase ${formatCurrency(purchasePrice, { compact: true })}`, fill: '#94a3b8', fontSize: 11, position: 'insideBottomLeft' }}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="value"
            name="Estimated value"
            stroke={RE_GREEN}
            strokeWidth={2}
            dot={{ r: 3, fill: RE_GREEN, stroke: CARD_SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: CARD_SURFACE, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, sub, subClass = 'text-slate-500' }) {
  return (
    <div>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-slate-100">{value}</div>
      {sub ? <div className={`mt-0.5 text-xs ${subClass}`}>{sub}</div> : null}
    </div>
  );
}

function PropertyCard({ property, onEdit, onUpdateValue, onArchive }) {
  const [showHistory, setShowHistory] = useState(false);

  const meta = TYPE_META[property.property_type] || TYPE_META.other;
  const value = Number(property.estimated_value);
  const mortgage = Number(property.mortgage_balance) || 0;
  const purchase = property.purchase_price != null ? Number(property.purchase_price) : null;
  const gain = purchase != null ? value - purchase : null;
  const gainPct = purchase > 0 ? (gain / purchase) * 100 : null;
  const rentalMonthly = property.rental_frequency === 'annual'
    ? (Number(property.rental_income) || 0) / 12
    : Number(property.rental_income) || 0;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <meta.Icon size={20} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-slate-100">{property.name}</span>
              {property.is_primary_residence ? (
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">Primary</span>
              ) : null}
            </div>
            {property.address ? <div className="text-sm text-slate-400">{property.address}</div> : null}
          </div>
        </div>
        <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">{meta.label}</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
        <Stat label="Estimated value" value={formatCurrency(value)} />
        <Stat label="Mortgage balance" value={formatCurrency(mortgage)}
          sub={property.mortgage_rate != null ? `${Number(property.mortgage_rate)}% rate${property.mortgage_payment > 0 ? ` · ${formatCurrency(property.mortgage_payment)}/mo` : ''}` : null} />
        <Stat label="Equity" value={formatCurrency(property.equity)} />
        {purchase != null ? (
          <Stat label="Purchase price" value={formatCurrency(purchase)}
            sub={property.purchase_date ? formatDate(property.purchase_date) : null} />
        ) : null}
        {rentalMonthly > 0 ? (
          <Stat label="Rental income" value={`${formatCurrency(rentalMonthly)}/mo`}
            sub={`${formatCurrency(property.annual_rental_income)} / year`} />
        ) : null}
        {gain != null ? (
          <Stat
            label="Unrealized gain"
            value={`${gain >= 0 ? '+' : '−'}${formatCurrency(Math.abs(gain))}`}
            sub={gainPct != null ? `${gain >= 0 ? '+' : ''}${gainPct.toFixed(1)}% since purchase` : null}
            subClass={gain >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
        ) : null}
      </div>

      {property.notes ? <p className="mt-4 text-sm text-slate-500">{property.notes}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
        <Button className="bg-slate-700 px-3 py-1.5 hover:bg-slate-600" onClick={onUpdateValue}>Update Value</Button>
        <Button className="bg-slate-700 px-3 py-1.5 hover:bg-slate-600" onClick={() => setShowHistory((s) => !s)}>
          {showHistory ? 'Hide History' : 'View History'}
        </Button>
        <Button className="bg-slate-700 px-3 py-1.5 hover:bg-slate-600" onClick={onEdit}>Edit</Button>
        <Button className="ml-auto bg-slate-800 px-3 py-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-300" onClick={onArchive}>
          Archive
        </Button>
      </div>

      {showHistory ? <ValueHistoryChart propertyId={property.id} /> : null}
    </Card>
  );
}

export default function RealEstate() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(null); // {mode:'add'} | {mode:'edit',property} | {mode:'value',property}
  const [archiveTarget, setArchiveTarget] = useState(null);

  const propertiesQuery = useQuery({
    queryKey: ['properties'],
    queryFn: async () => (await apiClient.get('/properties')).data,
  });

  const archiveMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/properties/${id}`),
    onSuccess: () => {
      setArchiveTarget(null);
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['net-worth'] });
    },
  });

  const refresh = () => {
    setModal(null);
    queryClient.invalidateQueries({ queryKey: ['properties'] });
    queryClient.invalidateQueries({ queryKey: ['net-worth'] });
  };

  const data = propertiesQuery.data;
  const properties = (data?.properties || []).filter((p) => !p.archived_at);
  const totals = data?.totals || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold">Real Estate</h2>
        <Button onClick={() => setModal({ mode: 'add' })}>+ Add Property</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Card className="p-4">
          <div className="text-sm text-slate-400">Total Value</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">
            {formatCurrency(totals.total_real_estate_value || 0)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-slate-400">Total Mortgage</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">
            {formatCurrency(totals.total_mortgage_balance || 0)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-slate-400">Total Equity</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-400">
            {formatCurrency(totals.total_equity || 0)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-slate-400">Monthly Rental Income</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">
            {formatCurrency(totals.total_monthly_rental_income || 0)}
          </div>
        </Card>
      </div>

      {propertiesQuery.isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400">Loading properties…</p>
      ) : properties.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-400">
            Add your first property to track real estate equity alongside your portfolio.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {properties.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              onEdit={() => setModal({ mode: 'edit', property })}
              onUpdateValue={() => setModal({ mode: 'value', property })}
              onArchive={() => setArchiveTarget(property)}
            />
          ))}
        </div>
      )}

      {modal?.mode === 'add' || modal?.mode === 'edit' ? (
        <PropertyModal property={modal.property || null} onClose={() => setModal(null)} onSaved={refresh} />
      ) : null}
      {modal?.mode === 'value' ? (
        <UpdateValueModal property={modal.property} onClose={() => setModal(null)} onSaved={refresh} />
      ) : null}

      {archiveTarget ? (
        <ConfirmDialog
          isOpen
          title="Archive property?"
          message={`"${archiveTarget.name}" will be removed from totals but its value history is kept.`}
          confirmLabel="Archive"
          onConfirm={() => archiveMutation.mutate(archiveTarget.id)}
          onCancel={() => setArchiveTarget(null)}
        />
      ) : null}
    </div>
  );
}
