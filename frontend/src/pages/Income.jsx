import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  TrendingUp,
  X,
} from 'lucide-react';

import apiClient from '../api/client';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useActiveProfile } from '../store/useActiveProfile';
import Skeleton from '../components/shared/Skeleton';
import { formatCurrency } from '../lib/accountTypes';

// ─── constants ────────────────────────────────────────────────────────────────

const RECURRING_TYPES = [
  { value: 'social_security', label: 'Social Security', icon: '🏛️', color: '#38bdf8' },
  { value: 'pension',         label: 'Pension',         icon: '🏦', color: '#34d399' },
  { value: 'annuity',         label: 'Annuity',         icon: '📋', color: '#a78bfa' },
  { value: 'rental',          label: 'Rental Income',   icon: '🏢', color: '#fbbf24' },
  { value: 'employment',      label: 'Employment',      icon: '💼', color: '#60a5fa' },
  { value: 'other',           label: 'Other',           icon: '⚡', color: '#f472b6' },
];

const EVENT_INCOME_TYPES = [
  { value: 'dividend',     label: 'Dividend',      color: '#3987e5' },
  { value: 'interest',     label: 'Interest',      color: '#199e70' },
  { value: 'rental',       label: 'Rental',        color: '#d55181' },
  { value: 'capital_gain', label: 'Capital gain',  color: '#c98500' },
  { value: 'other',        label: 'Other',         color: '#9085e9' },
];

const TAX_TREATMENTS = [
  { value: 'taxable',      label: 'Taxable'          },
  { value: 'tax_deferred', label: 'Tax-deferred'     },
  { value: 'tax_free',     label: 'Tax-free'         },
];

const EMPTY_FORM = {
  name:                  '',
  income_type:           'social_security',
  monthly_amount:        '',
  start_type:            'age',
  start_age:             '',
  start_date:            '',
  end_type:              'lifetime',
  end_age:               '',
  end_date:              '',
  end_years:             '',
  is_inflation_adjusted: false,
  annual_increase_pct:   '0',
  tax_treatment:         'taxable',
  notes:                 '',
};

function rtMeta(value) {
  return RECURRING_TYPES.find((t) => t.value === value) || RECURRING_TYPES[RECURRING_TYPES.length - 1];
}

function eventMeta(value) {
  return EVENT_INCOME_TYPES.find((t) => t.value === value) || EVENT_INCOME_TYPES[EVENT_INCOME_TYPES.length - 1];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function startLabel(src) {
  if (src.start_type === 'now') return 'Active now';
  if (src.start_type === 'age' && src.start_age) return `Starts at age ${src.start_age}`;
  if (src.start_type === 'date' && src.start_date) return `Starts ${src.start_date}`;
  return 'Starts —';
}

function endLabel(src) {
  if (src.end_type === 'lifetime') return 'Lifetime';
  if (src.end_type === 'age' && src.end_age) return `Ends at age ${src.end_age}`;
  if (src.end_type === 'date' && src.end_date) return `Ends ${src.end_date}`;
  if (src.end_type === 'years' && src.end_years) return `${src.end_years}-year certain`;
  return 'Ends —';
}

const selectCls =
  'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ' +
  'focus:border-sky-500 focus:outline-none';

// ─── INCOME TIMELINE ─────────────────────────────────────────────────────────

function IncomeTimeline({ sources, currentAge, retirementAge }) {
  const [hovered, setHovered] = useState(null);

  const minAge = Math.max(50, currentAge - 3);
  const maxAge = 95;
  const range  = maxAge - minAge;

  const toLeft  = (age) => `${(Math.max(0, Math.min(age, maxAge) - minAge) / range) * 100}%`;
  const toWidth = (s, e) => `${(Math.max(0, Math.min(e, maxAge) - Math.max(s, minAge)) / range) * 100}%`;

  const ageMarkers = [];
  for (let a = Math.ceil(minAge / 5) * 5; a <= maxAge; a += 5) ageMarkers.push(a);

  const activeSources = sources.filter((s) => s.is_active);

  if (activeSources.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Income Timeline
      </h3>

      {/* Age axis */}
      <div className="mb-2 ml-36 mr-0 flex select-none justify-between text-xs text-slate-600">
        {ageMarkers.map((a) => (
          <span key={a} className="w-0 text-center">{a}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="space-y-1.5">
        {activeSources.map((src) => {
          const meta       = rtMeta(src.income_type);
          const rawStart   = src.start_type === 'now' ? currentAge : (src.resolvedStartAge ?? currentAge);
          const rawEnd     = src.resolvedEndAge ?? maxAge;
          const isHovered  = hovered === src.id;

          return (
            <div key={src.id} className="flex items-center gap-3">
              {/* Label */}
              <div className="w-36 shrink-0 truncate text-xs text-slate-400" title={src.name}>
                <span className="mr-1">{meta.icon}</span>
                {src.name}
              </div>

              {/* Bar track */}
              <div className="relative h-5 flex-1 rounded bg-slate-800">
                {/* Current-age marker */}
                <div
                  className="absolute top-0 h-full w-px bg-sky-500/50"
                  style={{ left: toLeft(currentAge) }}
                />
                {/* Retirement-age marker */}
                <div
                  className="absolute top-0 h-full w-px bg-emerald-500/40"
                  style={{ left: toLeft(retirementAge) }}
                />

                {/* Income bar */}
                <div
                  className="absolute top-0.5 h-4 rounded cursor-pointer transition-opacity"
                  style={{
                    left:            toLeft(rawStart),
                    width:           toWidth(rawStart, rawEnd),
                    backgroundColor: meta.color,
                    opacity:         isHovered ? 1 : 0.75,
                  }}
                  onMouseEnter={() => setHovered(src.id)}
                  onMouseLeave={() => setHovered(null)}
                  title={`${src.name}: ${formatCurrency(src.monthly_amount)}/mo`}
                />
              </div>

              {/* Monthly */}
              <div className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-slate-300">
                {formatCurrency(src.monthly_amount)}/mo
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-sky-500/50" /> Now (age {currentAge})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500/40" /> Retirement (age {retirementAge})
        </span>
      </div>
    </div>
  );
}

// ─── INCOME CARD ─────────────────────────────────────────────────────────────

function IncomeCard({ src, currentAge, retirementAge, onEdit, onDelete, onToggle }) {
  const meta = rtMeta(src.income_type);
  const [delConfirm, setDelConfirm] = useState(false);

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-opacity ${
        src.is_active
          ? 'border-slate-700 bg-slate-800/50'
          : 'border-slate-800 bg-slate-900/40 opacity-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg leading-none">{meta.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-100">{src.name}</span>
              {src.isCurrentlyActive && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                  Active
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {startLabel(src)} → {endLabel(src)}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* What-if toggle */}
          <button
            type="button"
            onClick={() => onToggle(src)}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              src.is_active
                ? 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
            title={src.is_active ? 'Exclude from projections' : 'Include in projections'}
          >
            {src.is_active ? 'Included' : 'Excluded'}
          </button>
          <button
            type="button"
            onClick={() => onEdit(src)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          {delConfirm ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onDelete(src.id)}
                className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-400/10"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setDelConfirm(false)}
                className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDelConfirm(true)}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-700 hover:text-red-400"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Monthly" value={formatCurrency(src.monthly_amount)} />
        {src.monthlyAtRetirement > 0 && src.monthly_amount !== src.monthlyAtRetirement && (
          <Stat
            label={`At age ${retirementAge}`}
            value={formatCurrency(src.monthlyAtRetirement)}
          />
        )}
        <Stat
          label="Tax"
          value={TAX_TREATMENTS.find((t) => t.value === src.tax_treatment)?.label || src.tax_treatment}
        />
        {src.annual_increase_pct > 0 && (
          <Stat label="COLA" value={`+${src.annual_increase_pct}%/yr`} />
        )}
        {src.notes && (
          <div className="col-span-2 mt-1 text-xs text-slate-500 sm:col-span-3 lg:col-span-4">
            {src.notes}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium tabular-nums text-slate-200">{value}</div>
    </div>
  );
}

// ─── INCOME MODAL ─────────────────────────────────────────────────────────────

const STEPS = ['Basic', 'When', 'Growth & Tax', 'Notes'];

function IncomeModal({ initial, onClose, onSaved }) {
  const [step,  setStep]  = useState(0);
  const [form,  setForm]  = useState(() => (initial ? formFromSrc(initial) : EMPTY_FORM));
  const [error, setError] = useState('');

  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload(form);
      if (initial?.id) {
        return apiClient.put(`/recurring-income/${initial.id}`, payload);
      }
      return apiClient.post('/recurring-income', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      onSaved();
    },
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save'),
  });

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target?.value ?? e }));

  const setBool = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.checked }));

  const canAdvance = () => {
    if (step === 0) return form.name.trim() && form.monthly_amount !== '';
    return true;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-100">
            {initial ? 'Edit Income Source' : 'Add Income Source'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 border-b border-slate-800 px-6 py-3">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => i < step || canAdvance() ? setStep(i) : null}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                i === step
                  ? 'bg-sky-500/20 text-sky-300'
                  : i < step
                  ? 'text-slate-400 hover:text-slate-300'
                  : 'text-slate-600'
              }`}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* ── Step 0: Basic ── */}
          {step === 0 && (
            <>
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={set('name')}
                  placeholder="e.g. Don's Social Security"
                  autoFocus
                />
              </Field>
              <Field label="Type">
                <select className={selectCls} value={form.income_type} onChange={set('income_type')}>
                  {RECURRING_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Monthly Amount ($)">
                <Input
                  type="number"
                  min="0"
                  step="100"
                  value={form.monthly_amount}
                  onChange={set('monthly_amount')}
                  placeholder="3500"
                />
              </Field>
            </>
          )}

          {/* ── Step 1: When ── */}
          {step === 1 && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-300">Starts</legend>
                {[
                  { v: 'now',  l: 'Right now (already active)' },
                  { v: 'age',  l: 'At age' },
                  { v: 'date', l: 'On date' },
                ].map(({ v, l }) => (
                  <label key={v} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="start_type"
                      value={v}
                      checked={form.start_type === v}
                      onChange={set('start_type')}
                      className="accent-sky-500"
                    />
                    {l}
                    {v === 'age' && form.start_type === 'age' && (
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={form.start_age}
                        onChange={set('start_age')}
                        className="ml-1 w-20"
                        placeholder="67"
                      />
                    )}
                    {v === 'date' && form.start_type === 'date' && (
                      <Input
                        type="date"
                        value={form.start_date}
                        onChange={set('start_date')}
                        className="ml-1"
                      />
                    )}
                  </label>
                ))}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-300">Ends</legend>
                {[
                  { v: 'lifetime', l: 'Never (lifetime)' },
                  { v: 'age',      l: 'At age' },
                  { v: 'date',     l: 'On date' },
                  { v: 'years',    l: 'After' },
                ].map(({ v, l }) => (
                  <label key={v} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="end_type"
                      value={v}
                      checked={form.end_type === v}
                      onChange={set('end_type')}
                      className="accent-sky-500"
                    />
                    {l}
                    {v === 'age' && form.end_type === 'age' && (
                      <Input
                        type="number"
                        min="0"
                        max="120"
                        value={form.end_age}
                        onChange={set('end_age')}
                        className="ml-1 w-20"
                        placeholder="85"
                      />
                    )}
                    {v === 'date' && form.end_type === 'date' && (
                      <Input
                        type="date"
                        value={form.end_date}
                        onChange={set('end_date')}
                        className="ml-1"
                      />
                    )}
                    {v === 'years' && form.end_type === 'years' && (
                      <>
                        <Input
                          type="number"
                          min="1"
                          max="50"
                          value={form.end_years}
                          onChange={set('end_years')}
                          className="ml-1 w-20"
                          placeholder="20"
                        />
                        <span className="text-slate-500">years</span>
                      </>
                    )}
                  </label>
                ))}
              </fieldset>
            </>
          )}

          {/* ── Step 2: Growth & Tax ── */}
          {step === 2 && (
            <>
              <label className="flex items-center gap-2.5 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.is_inflation_adjusted}
                  onChange={setBool('is_inflation_adjusted')}
                  className="accent-sky-500"
                />
                Inflation / COLA adjusted
              </label>
              {form.is_inflation_adjusted && (
                <Field label="Annual increase (%)">
                  <Input
                    type="number"
                    min="0"
                    max="20"
                    step="0.1"
                    value={form.annual_increase_pct}
                    onChange={set('annual_increase_pct')}
                    placeholder="2.5"
                  />
                </Field>
              )}

              <Field label="Tax treatment">
                <div className="space-y-2">
                  {TAX_TREATMENTS.map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-2.5 text-sm text-slate-300">
                      <input
                        type="radio"
                        name="tax_treatment"
                        value={value}
                        checked={form.tax_treatment === value}
                        onChange={set('tax_treatment')}
                        className="accent-sky-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Field>
            </>
          )}

          {/* ── Step 3: Notes ── */}
          {step === 3 && (
            <Field label="Notes (optional)">
              <textarea
                className={`${selectCls} h-24 resize-none`}
                value={form.notes}
                onChange={set('notes')}
                placeholder="Any details about this income source…"
              />
            </Field>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-md bg-red-400/10 px-3 py-2 text-sm text-red-400">
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-300"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                onClick={() => setStep((s) => s - 1)}
                className="bg-slate-700 text-slate-300 hover:bg-slate-600"
              >
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()}>
                Next
              </Button>
            ) : (
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !form.name.trim() || form.monthly_amount === ''}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save Income Source'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function formFromSrc(src) {
  return {
    name:                  src.name || '',
    income_type:           src.income_type || 'other',
    monthly_amount:        String(src.monthly_amount ?? ''),
    start_type:            src.start_type || 'age',
    start_age:             String(src.start_age ?? ''),
    start_date:            src.start_date || '',
    end_type:              src.end_type || 'lifetime',
    end_age:               String(src.end_age ?? ''),
    end_date:              src.end_date || '',
    end_years:             String(src.end_years ?? ''),
    is_inflation_adjusted: Boolean(src.is_inflation_adjusted),
    annual_increase_pct:   String(src.annual_increase_pct ?? '0'),
    tax_treatment:         src.tax_treatment || 'taxable',
    notes:                 src.notes || '',
  };
}

function buildPayload(form) {
  return {
    name:                  form.name.trim(),
    income_type:           form.income_type,
    monthly_amount:        Number(form.monthly_amount) || 0,
    start_type:            form.start_type,
    start_age:             form.start_type === 'age'  ? Number(form.start_age) || null : null,
    start_date:            form.start_type === 'date' ? form.start_date || null        : null,
    end_type:              form.end_type,
    end_age:               form.end_type === 'age'    ? Number(form.end_age)   || null : null,
    end_date:              form.end_type === 'date'   ? form.end_date  || null         : null,
    end_years:             form.end_type === 'years'  ? Number(form.end_years) || null : null,
    is_inflation_adjusted: form.is_inflation_adjusted,
    annual_increase_pct:   form.is_inflation_adjusted ? Number(form.annual_increase_pct) || 0 : 0,
    tax_treatment:         form.tax_treatment,
    notes:                 form.notes.trim() || null,
  };
}

// ─── RECURRING SOURCES TAB ───────────────────────────────────────────────────

function RecurringSourcesTab() {
  const pid          = useActiveProfile();
  const queryClient  = useQueryClient();
  const [modal, setModal] = useState(null); // null | 'new' | { src }

  const sourcesQuery = useQuery({
    queryKey: ['recurring-income', pid],
    queryFn:  async () => (await apiClient.get('/recurring-income')).data,
  });

  const summaryQuery = useQuery({
    queryKey: ['recurring-income-summary', pid],
    queryFn:  async () => (await apiClient.get('/recurring-income/summary')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/recurring-income/${id}`),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-income-summary'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (src) =>
      apiClient.put(`/recurring-income/${src.id}`, { ...buildPayload(formFromSrc(src)), is_active: !src.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-income-summary'] });
    },
  });

  const sources     = sourcesQuery.data || [];
  const summary     = summaryQuery.data;
  const currentAge  = summary?.currentAge    || 62;
  const retireAge   = summary?.retirementAge || 67;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
    queryClient.invalidateQueries({ queryKey: ['recurring-income-summary'] });
    setModal(null);
  };

  // Group by type for display
  const grouped = useMemo(() => {
    const map = new Map();
    for (const t of RECURRING_TYPES) map.set(t.value, []);
    for (const s of sources) {
      if (map.has(s.income_type)) map.get(s.income_type).push(s);
      else map.get('other').push(s);
    }
    return [...map.entries()].filter(([, arr]) => arr.length > 0);
  }, [sources]);

  const activeSources = sources.filter((s) => s.is_active);

  return (
    <>
      {/* Summary bar */}
      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-7 w-32" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Active now"
            value={summary?.currentMonthly ?? 0}
            suffix="/mo"
            dim={activeSources.filter((s) => s.isCurrentlyActive).length === 0}
          />
          <SummaryCard
            label={`At retirement (age ${retireAge})`}
            value={summary?.atRetirement?.monthly ?? 0}
            suffix="/mo"
            highlight
          />
          <SummaryCard
            label="Annual at retirement"
            value={summary?.atRetirement?.annual ?? 0}
            suffix="/yr"
          />
        </div>
      )}

      {/* Excluded-source warning */}
      {sources.some((s) => !s.is_active) && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-400">
          <AlertCircle size={14} className="shrink-0" />
          {sources.filter((s) => !s.is_active).length} source
          {sources.filter((s) => !s.is_active).length > 1 ? 's' : ''} excluded from projections
          (what-if mode). Retirement income without them:{' '}
          <span className="font-medium">
            {formatCurrency(summary?.atRetirement?.monthly ?? 0)}/mo
          </span>
        </div>
      )}

      {/* Timeline */}
      {sourcesQuery.isLoading ? (
        <Card><Skeleton className="h-32 w-full" /></Card>
      ) : activeSources.length > 0 ? (
        <Card>
          <IncomeTimeline
            sources={activeSources}
            currentAge={currentAge}
            retirementAge={retireAge}
          />
        </Card>
      ) : null}

      {/* Breakdown at retirement */}
      {(summary?.atRetirement?.breakdown?.length ?? 0) > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            At Retirement — Breakdown
          </h3>
          <div className="space-y-1.5">
            {summary.atRetirement.breakdown.map((b) => {
              const meta = rtMeta(b.type);
              return (
                <div key={b.id} className="flex items-center gap-3 text-sm">
                  <span className="text-base leading-none">{meta.icon}</span>
                  <span className="flex-1 text-slate-300">{b.name}</span>
                  {b.note && (
                    <span className="text-xs text-slate-600">{b.note}</span>
                  )}
                  <span
                    className="w-24 text-right font-medium tabular-nums"
                    style={{ color: b.monthly > 0 ? meta.color : '#475569' }}
                  >
                    {b.monthly > 0 ? `${formatCurrency(b.monthly)}/mo` : '—'}
                  </span>
                </div>
              );
            })}
            <div className="mt-2 flex items-center gap-3 border-t border-slate-800 pt-2 text-sm font-semibold">
              <span className="flex-1 text-slate-300">Total guaranteed</span>
              <span className="w-24 text-right tabular-nums text-sky-300">
                {formatCurrency(summary.atRetirement.monthly)}/mo
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Source cards grouped by type */}
      {sourcesQuery.isLoading ? (
        <Card><Skeleton className="h-24 w-full" /></Card>
      ) : sources.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <RefreshCw size={28} className="text-slate-600" />
            <div className="text-slate-400">No recurring income sources yet.</div>
            <div className="max-w-xs text-sm text-slate-600">
              Add Social Security, a pension, rental income, or any ongoing income stream
              to see how it funds your retirement.
            </div>
            <Button onClick={() => setModal('new')} className="mt-2 flex items-center gap-2">
              <Plus size={15} /> Add First Income Source
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([type, group]) => {
            const meta = rtMeta(type);
            return (
              <div key={type}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-base leading-none">{meta.icon}</span>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {meta.label}
                  </h3>
                </div>
                <div className="space-y-2">
                  {group.map((src) => (
                    <IncomeCard
                      key={src.id}
                      src={src}
                      currentAge={currentAge}
                      retirementAge={retireAge}
                      onEdit={(s) => setModal(s)}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onToggle={(s) => toggleMutation.mutate(s)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add button */}
      {sources.length > 0 && (
        <Button onClick={() => setModal('new')} className="flex items-center gap-2">
          <Plus size={15} /> Add Income Source
        </Button>
      )}

      {/* Modal */}
      {modal !== null && (
        <IncomeModal
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}

function SummaryCard({ label, value, suffix, highlight, dim }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          highlight
            ? 'text-sky-300'
            : dim
            ? 'text-slate-600'
            : 'text-slate-100'
        }`}
      >
        {formatCurrency(value)}
        <span className="text-sm font-normal text-slate-500">{suffix}</span>
      </div>
    </Card>
  );
}

// ─── INVESTMENT INCOME TAB (existing functionality, preserved) ────────────────

const EVENT_TAX_LABELS = {
  taxable:      'Taxable',
  tax_deferred: 'Tax-deferred',
  tax_free:     'Tax-free',
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm shadow-lg">
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      {payload.filter((e) => e.value > 0).map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: entry.fill }} />
          <span className="text-slate-300">{entry.name}</span>
          <span className="ml-auto pl-3 font-medium text-slate-100">{formatCurrency(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function formatMonth(month) {
  const [y, m] = String(month).split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('en-US', {
    month: 'short', timeZone: 'UTC',
  });
}

function AddIncomeForm({ accounts, onSaved }) {
  const [form, setForm] = useState({
    event_date:     new Date().toISOString().slice(0, 10),
    event_type:     'dividend',
    amount:         '',
    account_id:     '',
    symbol:         '',
    description:    '',
    tax_treatment:  'taxable',
  });
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const saveMutation = useMutation({
    mutationFn: async () => apiClient.post('/income', {
      ...form,
      account_id: form.account_id || null,
      amount:     Number(form.amount),
    }),
    onSuccess: () => {
      setErr('');
      setForm((p) => ({ ...p, amount: '', symbol: '', description: '' }));
      onSaved();
    },
    onError: (e) => setErr(e?.response?.data?.error || 'Failed to add income'),
  });

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Add Income Event</h3>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="space-y-1">
          <label className="block text-sm text-slate-400">Date</label>
          <Input type="date" value={form.event_date} onChange={set('event_date')} />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400">Type</label>
          <select className={selectCls} value={form.event_type} onChange={set('event_type')}>
            {EVENT_INCOME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400">Amount ($)</label>
          <Input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400">Account</label>
          <select className={selectCls} value={form.account_id} onChange={set('account_id')}>
            <option value="">(none)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name || a.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400">Symbol (optional)</label>
          <Input value={form.symbol} onChange={set('symbol')} placeholder="VTI" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400">Description (optional)</label>
          <Input value={form.description} onChange={set('description')} />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400">Tax treatment</label>
          <select className={selectCls} value={form.tax_treatment} onChange={set('tax_treatment')}>
            {TAX_TREATMENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.amount || !form.event_date}
          >
            {saveMutation.isPending ? 'Adding…' : 'Add Income'}
          </Button>
        </div>
      </div>
      {err ? <p className="mt-3 text-sm text-red-400">{err}</p> : null}
    </Card>
  );
}

function InvestmentIncomeTab() {
  const pid         = useActiveProfile();
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ['income-summary', pid],
    queryFn:  async () => (await apiClient.get('/income/summary')).data,
  });
  const eventsQuery = useQuery({
    queryKey: ['income-events', pid],
    queryFn:  async () => (await apiClient.get('/income')).data,
  });
  const accountsQuery = useQuery({
    queryKey: ['accounts', pid],
    queryFn:  async () => (await apiClient.get('/accounts')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/income/${id}`),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['income-events'] });
      queryClient.invalidateQueries({ queryKey: ['income-summary'] });
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['income-events'] });
    queryClient.invalidateQueries({ queryKey: ['income-summary'] });
  };

  const summary  = summaryQuery.data;
  const events   = eventsQuery.data || [];
  const accounts = (accountsQuery.data || []).filter((a) => !a.archived_at);

  const chartData = useMemo(() => {
    if (!summary) return [];
    return summary.ytd.byMonth.map((m) => ({
      month:        formatMonth(m.month),
      dividend:     m.dividend     || 0,
      interest:     m.interest     || 0,
      rental:       m.rental       || 0,
      capital_gain: m.capital_gain || 0,
      other:        m.other        || 0,
    }));
  }, [summary]);

  const activeTypes = useMemo(
    () => EVENT_INCOME_TYPES.filter((t) => chartData.some((m) => m[t.value] > 0)),
    [chartData],
  );

  return (
    <>
      {/* Stat cards */}
      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="mt-2 h-8 w-32" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Card className="p-4">
            <div className="text-sm text-slate-400">YTD Income</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">{formatCurrency(summary?.ytd?.total || 0)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-400">Last 12 Months</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">{formatCurrency(summary?.trailing12?.total || 0)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-400">Projected Annual</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">
              {formatCurrency(summary?.projected?.annual || 0)}
              <span className="text-sm font-normal text-slate-500">/yr</span>
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-400">Monthly Average</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">
              {formatCurrency(summary?.projected?.monthly || 0)}
              <span className="text-sm font-normal text-slate-500">/mo</span>
            </div>
          </Card>
        </div>
      )}

      <AddIncomeForm accounts={accounts} onSaved={refresh} />

      {!summaryQuery.isLoading && events.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-400">
            No income events recorded yet. Add dividends, interest, or rental income above.
          </p>
        </Card>
      ) : null}

      {chartData.length > 0 && (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Monthly Income ({new Date().getFullYear()})</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 12 }}
                  axisLine={{ stroke: '#334155' }} tickLine={false} />
                <YAxis tickFormatter={(v) => formatCurrency(v, { compact: true })}
                  tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                {activeTypes.map((t) => (
                  <Bar key={t.value} dataKey={t.value} name={t.label} stackId="income"
                    fill={t.color} stroke="#0f172a" strokeWidth={1} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
            {activeTypes.map((t) => (
              <li key={t.value} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                {t.label}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(summary?.byAccount?.length || 0) > 0 && (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Income by Account (YTD)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-slate-400">
                  <th className="py-2 pr-4 font-normal">Account</th>
                  <th className="py-2 pr-4 font-normal">Type</th>
                  <th className="py-2 pr-4 font-normal">Tax Treatment</th>
                  <th className="py-2 text-right font-normal">YTD Income</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {summary.byAccount.map((row, i) => (
                  <tr key={i} className="border-b border-slate-800/40">
                    <td className="py-1.5 pr-4">{row.accountName}</td>
                    <td className="py-1.5 pr-4 text-slate-400">{row.accountType || '—'}</td>
                    <td className="py-1.5 pr-4 text-slate-400">
                      {EVENT_TAX_LABELS[row.taxTreatment] || row.taxTreatment}
                    </td>
                    <td className="py-1.5 text-right font-mono">{formatCurrency(row.ytdTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Recent Income Events</h3>
          <div className="space-y-1.5 text-sm">
            {events.slice(0, 25).map((e) => {
              const meta = eventMeta(e.event_type);
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-md border border-slate-800 px-3 py-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                  <span className="text-slate-300">
                    {new Date(e.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                  </span>
                  <span className="text-slate-400">{meta.label}</span>
                  {e.symbol     && <span className="font-mono text-xs text-slate-500">{e.symbol}</span>}
                  {e.account_name && <span className="truncate text-xs text-slate-500">{e.account_name}</span>}
                  <span className="ml-auto font-medium text-slate-100">{formatCurrency(e.amount)}</span>
                  <button
                    type="button"
                    className="text-slate-500 hover:text-red-400"
                    title="Delete"
                    onClick={() => deleteMutation.mutate(e.id)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'recurring',   label: 'Recurring Sources', icon: RefreshCw },
  { id: 'investment',  label: 'Investment Income',  icon: TrendingUp },
];

export default function Income() {
  const [tab, setTab] = useState('recurring');

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-semibold text-slate-100">Income</h2>
        <p className="mt-1 text-sm text-slate-500">
          Track recurring income streams and investment income to model your retirement cash flow.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 pb-3 pt-1 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-b-2 border-sky-500 text-sky-300'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'recurring'  && <RecurringSourcesTab />}
      {tab === 'investment' && <InvestmentIncomeTab />}
    </div>
  );
}
