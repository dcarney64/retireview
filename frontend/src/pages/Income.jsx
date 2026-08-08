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

import IncludeToggle from '../components/shared/IncludeToggle';

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
  { value: 'taxable',      label: 'Taxable'      },
  { value: 'tax_deferred', label: 'Tax-deferred' },
  { value: 'tax_free',     label: 'Tax-free'     },
];

// ─── empty form & type defaults ───────────────────────────────────────────────

const BASE_FORM = {
  name:                 '',
  income_type:          'social_security',
  monthly_amount:       '',
  gross_monthly_amount: '',
  survivor_benefit_pct: '',
  start_type:           'age',
  start_age:            '',
  start_date:           '',
  end_type:             'lifetime',
  end_age:              '',
  end_date:             '',
  end_years:            '',
  is_inflation_adjusted: false,
  annual_increase_pct:  '0',
  tax_treatment:        'taxable',
  notes:                '',
  ends_at_retirement:   false,
};

function emptyForType(type) {
  switch (type) {
    case 'social_security':
      return { ...BASE_FORM, income_type: 'social_security',
               start_type: 'age', start_age: '67', end_type: 'lifetime',
               is_inflation_adjusted: true, annual_increase_pct: '2.5',
               tax_treatment: 'taxable' };
    case 'pension':
      return { ...BASE_FORM, income_type: 'pension',
               start_type: 'age', start_age: '', end_type: 'lifetime',
               is_inflation_adjusted: false, annual_increase_pct: '0',
               tax_treatment: 'taxable' };
    case 'annuity':
      return { ...BASE_FORM, income_type: 'annuity',
               start_type: 'age', start_age: '', end_type: 'lifetime',
               is_inflation_adjusted: false, annual_increase_pct: '0',
               tax_treatment: 'taxable' };
    case 'employment':
      return { ...BASE_FORM, income_type: 'employment',
               start_type: 'now', start_age: '', end_type: 'retirement',
               ends_at_retirement: true,
               is_inflation_adjusted: false, annual_increase_pct: '0',
               tax_treatment: 'taxable' };
    case 'rental':
      return { ...BASE_FORM, income_type: 'rental',
               start_type: 'now', start_age: '', end_type: 'lifetime',
               is_inflation_adjusted: false, annual_increase_pct: '0',
               tax_treatment: 'taxable' };
    default:
      return { ...BASE_FORM, income_type: type || 'other',
               start_type: 'now', start_age: '', end_type: 'lifetime' };
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function rtMeta(value) {
  return RECURRING_TYPES.find((t) => t.value === value) || RECURRING_TYPES[RECURRING_TYPES.length - 1];
}

function eventMeta(value) {
  return EVENT_INCOME_TYPES.find((t) => t.value === value) || EVENT_INCOME_TYPES[EVENT_INCOME_TYPES.length - 1];
}

function startLabel(src) {
  if (src.start_type === 'now') return 'Active now';
  if (src.start_type === 'age' && src.start_age) return `Starts at age ${src.start_age}`;
  if (src.start_type === 'date' && src.start_date) return `Starts ${src.start_date}`;
  return 'Starts —';
}

function endLabel(src, retirementAge) {
  if (src.ends_at_retirement || src.end_type === 'retirement')
    return retirementAge ? `Ends at retirement (age ${retirementAge})` : 'Ends at retirement';
  if (src.end_type === 'lifetime') return 'Lifetime';
  if (src.end_type === 'age' && src.end_age) return `Ends at age ${src.end_age}`;
  if (src.end_type === 'date' && src.end_date) return `Ends ${src.end_date}`;
  if (src.end_type === 'years' && src.end_years) return `${src.end_years}-year certain`;
  return 'Ends —';
}

function formFromSrc(src) {
  return {
    name:                  src.name || '',
    income_type:           src.income_type || 'other',
    monthly_amount:        String(src.monthly_amount ?? ''),
    gross_monthly_amount:  src.gross_monthly_amount != null ? String(src.gross_monthly_amount) : '',
    survivor_benefit_pct:  src.survivor_benefit_pct != null ? String(src.survivor_benefit_pct) : '',
    start_type:            src.start_type || 'age',
    start_age:             String(src.start_age ?? ''),
    start_date:            src.start_date || '',
    // If ends_at_retirement is true in the DB, represent it as 'retirement' in the UI
    ends_at_retirement:    Boolean(src.ends_at_retirement),
    end_type:              src.ends_at_retirement ? 'retirement' : (src.end_type || 'lifetime'),
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
  const _sbp = form.survivor_benefit_pct;
  const _gma = form.gross_monthly_amount;
  // 'retirement' is a UI-only end_type; translate to DB flags
  const isRetirement = form.end_type === 'retirement';
  const dbEndType    = isRetirement ? 'lifetime' : form.end_type;
  return {
    name:                  form.name.trim(),
    income_type:           form.income_type,
    monthly_amount:        Number(form.monthly_amount) || 0,
    gross_monthly_amount:  _gma !== '' && _gma != null ? Number(_gma) : null,
    survivor_benefit_pct:  _sbp !== '' && _sbp != null ? Number(_sbp) : null,
    start_type:            form.start_type,
    start_age:             form.start_type === 'age'  ? Number(form.start_age) || null : null,
    start_date:            form.start_type === 'date' ? form.start_date || null        : null,
    ends_at_retirement:    isRetirement,
    end_type:              dbEndType,
    end_age:               dbEndType === 'age'   ? Number(form.end_age)   || null : null,
    end_date:              dbEndType === 'date'  ? form.end_date  || null         : null,
    end_years:             dbEndType === 'years' ? Number(form.end_years) || null : null,
    is_inflation_adjusted: form.is_inflation_adjusted,
    annual_increase_pct:   Number(form.annual_increase_pct) || 0,
    tax_treatment:         form.tax_treatment,
    notes:                 form.notes?.trim() || null,
  };
}

// ─── shared UI primitives ─────────────────────────────────────────────────────

const selectCls =
  'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ' +
  'focus:border-sky-500 focus:outline-none';

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm text-slate-400">{label}</label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Divider({ label }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="h-px flex-1 bg-slate-800" />
      <span className="text-xs font-medium uppercase tracking-wider text-slate-600">{label}</span>
      <div className="h-px flex-1 bg-slate-800" />
    </div>
  );
}

// ─── type-specific field sections ─────────────────────────────────────────────

function StartSection({ form, set, options = ['now', 'age', 'date'] }) {
  // For SS: just an age input, no radio
  if (options.length === 1 && options[0] === 'age-only') {
    return null; // handled inline in SSFields
  }
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-300">Starts</legend>
      {[
        { v: 'now',  l: 'Right now (already active)' },
        { v: 'age',  l: 'At age' },
        { v: 'date', l: 'On date' },
      ].filter(o => options.includes(o.v)).map(({ v, l }) => (
        <label key={v} className="flex items-center gap-2.5 text-sm text-slate-300">
          <input type="radio" name="start_type" value={v}
            checked={form.start_type === v} onChange={set('start_type')}
            className="accent-sky-500" />
          {l}
          {v === 'age' && form.start_type === 'age' && (
            <Input type="number" min="0" max="100" value={form.start_age}
              onChange={set('start_age')} className="ml-1 w-20" placeholder="65" />
          )}
          {v === 'date' && form.start_type === 'date' && (
            <Input type="date" value={form.start_date}
              onChange={set('start_date')} className="ml-1" />
          )}
        </label>
      ))}
    </fieldset>
  );
}

function EndSection({ form, set, options = ['lifetime', 'age', 'date', 'years'] }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-300">Ends</legend>
      {[
        { v: 'lifetime',   l: 'Never (lifetime)'     },
        { v: 'retirement', l: 'At retirement'         },
        { v: 'age',        l: 'At age'               },
        { v: 'date',       l: 'On date'              },
        { v: 'years',      l: 'After (term certain)' },
      ].filter(o => options.includes(o.v)).map(({ v, l }) => (
        <label key={v} className="flex items-start gap-2.5 text-sm text-slate-300">
          <input type="radio" name="end_type" value={v}
            checked={form.end_type === v} onChange={set('end_type')}
            className="accent-sky-500 mt-0.5 shrink-0" />
          <span className="flex flex-col gap-0.5">
            {l}
            {v === 'retirement' && form.end_type === 'retirement' && (
              <span className="text-xs text-amber-400/80">
                Uses retirement age from your active scenario.{' '}
                <a href="/retirement" className="underline hover:text-amber-300">
                  Change in Retirement settings →
                </a>
              </span>
            )}
          </span>
          {v === 'age' && form.end_type === 'age' && (
            <Input type="number" min="0" max="120" value={form.end_age}
              onChange={set('end_age')} className="ml-1 w-20" placeholder="85" />
          )}
          {v === 'date' && form.end_type === 'date' && (
            <Input type="date" value={form.end_date}
              onChange={set('end_date')} className="ml-1" />
          )}
          {v === 'years' && form.end_type === 'years' && (
            <>
              <Input type="number" min="1" max="50" value={form.end_years}
                onChange={set('end_years')} className="ml-1 w-20" placeholder="20" />
              <span className="text-slate-500">years</span>
            </>
          )}
        </label>
      ))}
    </fieldset>
  );
}

function TaxField({ form, set }) {
  return (
    <Field label="Tax treatment">
      <div className="flex gap-4">
        {TAX_TREATMENTS.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="radio" name="tax_treatment" value={value}
              checked={form.tax_treatment === value} onChange={set('tax_treatment')}
              className="accent-sky-500" />
            {label}
          </label>
        ))}
      </div>
    </Field>
  );
}

// ── Social Security ────────────────────────────────────────────────────────────

function SSFields({ form, set }) {
  return (
    <>
      <Field label="Name" hint="e.g. Don's Social Security, Jane's SS">
        <Input value={form.name} onChange={set('name')}
          placeholder="My Social Security" autoFocus />
      </Field>

      <Field label="Monthly benefit ($)"
             hint="Your estimated benefit at the claiming age below">
        <Input type="number" min="0" step="50" value={form.monthly_amount}
          onChange={set('monthly_amount')} placeholder="2000" />
      </Field>

      <Field label="Claiming age (62–70)">
        <div className="flex items-center gap-3">
          <Input type="number" min="62" max="70" value={form.start_age}
            onChange={set('start_age')} className="w-24" placeholder="67" />
          <span className="text-sm text-slate-500">
            {form.start_age < 67 ? '⚠️ Reduced benefit (early)' :
             form.start_age > 67 ? '✓ Increased benefit (delayed)' :
             'Full retirement age'}
          </span>
        </div>
      </Field>

      <Divider label="Growth & Tax" />

      <div className="rounded-md bg-slate-800/50 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">COLA (annual increase)</span>
          <div className="flex items-center gap-1.5">
            <Input type="number" min="0" max="10" step="0.1"
              value={form.annual_increase_pct} onChange={set('annual_increase_pct')}
              className="w-20 text-right text-sm" />
            <span className="text-sm text-slate-500">%/yr</span>
          </div>
        </div>
        <p className="text-xs text-slate-600">
          SS adjusts annually for inflation. Historical average ~2.5%/yr.
        </p>
      </div>

      <div className="rounded-md border border-slate-800 px-4 py-2.5 text-xs text-slate-500">
        📋 SS benefits are taxable income — up to 85% may be included in your taxable income depending on your total income.
      </div>

      <Field label="Notes (optional)">
        <textarea className={`${selectCls} h-16 resize-none`} value={form.notes}
          onChange={set('notes')} placeholder="Any notes…" />
      </Field>
    </>
  );
}

// ── Pension ───────────────────────────────────────────────────────────────────

function PensionFields({ form, set, setBool }) {
  return (
    <>
      <Field label="Plan or employer name">
        <Input value={form.name} onChange={set('name')}
          placeholder="e.g. CalPERS, Boeing Pension Plan" autoFocus />
      </Field>

      <Field label="Monthly benefit ($)" hint="Net amount you'll receive each month">
        <Input type="number" min="0" step="100" value={form.monthly_amount}
          onChange={set('monthly_amount')} placeholder="2500" />
      </Field>

      <Field label="Start age"
             hint="Age you'll begin receiving pension payments">
        <Input type="number" min="50" max="80" value={form.start_age}
          onChange={set('start_age')} className="w-24" placeholder="65" />
      </Field>

      <Field label="Survivor benefit (optional)"
             hint="Percentage of your benefit paid to your spouse/beneficiary if you die first">
        <div className="flex items-center gap-2">
          <Input type="number" min="0" max="100" step="5"
            value={form.survivor_benefit_pct} onChange={set('survivor_benefit_pct')}
            className="w-24" placeholder="50" />
          <span className="text-sm text-slate-500">% of your benefit</span>
        </div>
        <p className="text-xs text-slate-500">
          Common options: 50%, 75%, 100%. Leave blank if no survivor benefit.
        </p>
      </Field>

      <Divider label="Growth & Tax" />

      <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
        <input type="checkbox" checked={form.is_inflation_adjusted}
          onChange={setBool('is_inflation_adjusted')} className="accent-sky-500" />
        COLA adjusted (annual increase)
      </label>
      {form.is_inflation_adjusted && (
        <div className="ml-6 flex items-center gap-2">
          <Input type="number" min="0" max="10" step="0.1"
            value={form.annual_increase_pct} onChange={set('annual_increase_pct')}
            className="w-24" placeholder="2.0" />
          <span className="text-sm text-slate-500">%/yr</span>
        </div>
      )}

      <TaxField form={form} set={set} />

      <Divider label="Timing" />
      <EndSection form={form} set={set} options={['lifetime', 'years']} />

      <Field label="Notes (optional)">
        <textarea className={`${selectCls} h-16 resize-none`} value={form.notes}
          onChange={set('notes')} placeholder="Plan details, options elected…" />
      </Field>
    </>
  );
}

// ── Annuity ───────────────────────────────────────────────────────────────────

function AnnuityFields({ form, set, setBool }) {
  return (
    <>
      <Field label="Insurance company or policy name">
        <Input value={form.name} onChange={set('name')}
          placeholder="e.g. Northwestern Mutual, MetLife Annuity" autoFocus />
      </Field>

      <Field label="Monthly income ($)">
        <Input type="number" min="0" step="100" value={form.monthly_amount}
          onChange={set('monthly_amount')} placeholder="1500" />
      </Field>

      <Divider label="Timing" />

      <StartSection form={form} set={set} options={['age', 'date']} />
      <EndSection form={form} set={set} options={['lifetime', 'years']} />

      <Divider label="Growth & Tax" />

      <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
        <input type="checkbox" checked={form.is_inflation_adjusted}
          onChange={setBool('is_inflation_adjusted')} className="accent-sky-500" />
        Inflation rider (annual increase)
      </label>
      {form.is_inflation_adjusted && (
        <div className="ml-6 flex items-center gap-2">
          <Input type="number" min="0" max="10" step="0.1"
            value={form.annual_increase_pct} onChange={set('annual_increase_pct')}
            className="w-24" placeholder="2.0" />
          <span className="text-sm text-slate-500">%/yr</span>
        </div>
      )}

      <TaxField form={form} set={set} />

      <Field label="Notes (optional)">
        <textarea className={`${selectCls} h-16 resize-none`} value={form.notes}
          onChange={set('notes')} placeholder="Contract number, contact info…" />
      </Field>
    </>
  );
}

// ── Employment ────────────────────────────────────────────────────────────────

function EmploymentFields({ form, set }) {
  const hasGross = form.gross_monthly_amount !== '' && Number(form.gross_monthly_amount) > 0;
  const hasNet   = form.monthly_amount !== '' && Number(form.monthly_amount) > 0;
  const effectiveRate = hasGross && hasNet
    ? Math.round((Number(form.monthly_amount) / Number(form.gross_monthly_amount)) * 100)
    : null;

  return (
    <>
      <Field label="Employer or business name">
        <Input value={form.name} onChange={set('name')}
          placeholder="e.g. Acme Corp, Self-employed consulting" autoFocus />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Gross monthly ($)" hint="Before taxes and deductions">
          <Input type="number" min="0" step="100" value={form.gross_monthly_amount}
            onChange={set('gross_monthly_amount')} placeholder="optional" />
        </Field>
        <Field label="Net monthly ($)" hint="What hits your bank account">
          <Input type="number" min="0" step="100" value={form.monthly_amount}
            onChange={set('monthly_amount')} placeholder="5000" />
        </Field>
      </div>
      {effectiveRate !== null && (
        <p className="text-xs text-slate-400 -mt-2">
          Effective take-home rate: {effectiveRate}%
        </p>
      )}

      <Field label="Annual raise (%)">
        <div className="flex items-center gap-2">
          <Input type="number" min="0" max="20" step="0.5"
            value={form.annual_increase_pct} onChange={set('annual_increase_pct')}
            className="w-24" placeholder="0" />
          <span className="text-sm text-slate-500">%/yr (leave 0 if none)</span>
        </div>
      </Field>

      <Divider label="Timing" />

      <StartSection form={form} set={set} options={['now', 'age', 'date']} />
      <EndSection form={form} set={set} options={['lifetime', 'retirement', 'age', 'date']} />

      <Field label="Notes (optional)">
        <textarea className={`${selectCls} h-16 resize-none`} value={form.notes}
          onChange={set('notes')} placeholder="Job type, benefits, etc." />
      </Field>
    </>
  );
}

// ── Rental ────────────────────────────────────────────────────────────────────

function RentalFields({ form, set }) {
  return (
    <>
      <Field label="Property or rental name">
        <Input value={form.name} onChange={set('name')}
          placeholder="e.g. Commercial Rental, 123 Main St" autoFocus />
      </Field>

      <Field label="Monthly net income ($)"
             hint="After mortgage, insurance, maintenance, property tax">
        <Input type="number" min="0" step="50" value={form.monthly_amount}
          onChange={set('monthly_amount')} placeholder="1200" />
      </Field>

      <Field label="Annual rent increase (%)">
        <div className="flex items-center gap-2">
          <Input type="number" min="0" max="20" step="0.5"
            value={form.annual_increase_pct} onChange={set('annual_increase_pct')}
            className="w-24" placeholder="0" />
          <span className="text-sm text-slate-500">%/yr</span>
        </div>
      </Field>

      <Divider label="Timing" />

      <StartSection form={form} set={set} options={['now', 'date']} />
      <EndSection form={form} set={set} options={['lifetime', 'retirement', 'date']} />

      <TaxField form={form} set={set} />

      <Field label="Notes (optional)">
        <textarea className={`${selectCls} h-16 resize-none`} value={form.notes}
          onChange={set('notes')} placeholder="Address, tenant, lease details…" />
      </Field>
    </>
  );
}

// ── Other ─────────────────────────────────────────────────────────────────────

function OtherFields({ form, set, setBool }) {
  return (
    <>
      <Field label="Name / description">
        <Input value={form.name} onChange={set('name')}
          placeholder="e.g. Royalties, Trust distributions, Part-time work" autoFocus />
      </Field>

      <Field label="Monthly amount ($)">
        <Input type="number" min="0" step="100" value={form.monthly_amount}
          onChange={set('monthly_amount')} placeholder="500" />
      </Field>

      <Divider label="Timing" />

      <StartSection form={form} set={set} options={['now', 'age', 'date']} />
      <EndSection form={form} set={set} options={['lifetime', 'retirement', 'age', 'date', 'years']} />

      <Divider label="Growth & Tax" />

      <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
        <input type="checkbox" checked={form.is_inflation_adjusted}
          onChange={setBool('is_inflation_adjusted')} className="accent-sky-500" />
        Annual increase / COLA
      </label>
      {form.is_inflation_adjusted && (
        <div className="ml-6 flex items-center gap-2">
          <Input type="number" min="0" max="20" step="0.1"
            value={form.annual_increase_pct} onChange={set('annual_increase_pct')}
            className="w-24" placeholder="2.5" />
          <span className="text-sm text-slate-500">%/yr</span>
        </div>
      )}

      <TaxField form={form} set={set} />

      <Field label="Notes (optional)">
        <textarea className={`${selectCls} h-16 resize-none`} value={form.notes}
          onChange={set('notes')} placeholder="Source details, conditions…" />
      </Field>
    </>
  );
}

function TypeFields({ form, set, setBool }) {
  switch (form.income_type) {
    case 'social_security': return <SSFields         form={form} set={set} setBool={setBool} />;
    case 'pension':         return <PensionFields    form={form} set={set} setBool={setBool} />;
    case 'annuity':         return <AnnuityFields    form={form} set={set} setBool={setBool} />;
    case 'employment':      return <EmploymentFields form={form} set={set} setBool={setBool} />;
    case 'rental':          return <RentalFields     form={form} set={set} setBool={setBool} />;
    default:                return <OtherFields      form={form} set={set} setBool={setBool} />;
  }
}

// ─── INCOME TIMELINE ─────────────────────────────────────────────────────────

function IncomeTimeline({ sources, currentAge, retirementAge }) {
  const [hovered, setHovered] = useState(null);

  const minAge = Math.max(50, currentAge - 3);
  const maxAge = 95;
  const range  = maxAge - minAge;

  const toLeftPct = (age) => (Math.max(0, Math.min(age, maxAge) - minAge) / range) * 100;
  const toLeft    = (age) => `${toLeftPct(age)}%`;
  const toWidth   = (s, e) => `${(Math.max(0, Math.min(e, maxAge) - Math.max(s, minAge)) / range) * 100}%`;

  const retireLeftPct = toLeftPct(retirementAge);

  const ageMarkers = [];
  for (let a = Math.ceil(minAge / 5) * 5; a <= maxAge; a += 5) ageMarkers.push(a);

  const activeSources = sources.filter((s) => s.is_active);
  if (activeSources.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Income Timeline
      </h3>
      <div className="mb-2 ml-36 mr-0 flex select-none justify-between text-xs text-slate-600">
        {ageMarkers.map((a) => (
          <span key={a} className="w-0 text-center">{a}</span>
        ))}
      </div>
      <div className="space-y-1.5">
        {activeSources.map((src) => {
          const meta        = rtMeta(src.income_type);
          const rawStart    = src.start_type === 'now' ? currentAge : (src.resolvedStartAge ?? currentAge);
          const rawEnd      = src.ends_at_retirement ? retirementAge : (src.resolvedEndAge ?? maxAge);
          const isPreOnly   = Boolean(src.ends_at_retirement);
          const isPostOnly  = !src.ends_at_retirement && rawStart >= retirementAge;
          const isHovered   = hovered === src.id;

          // Blue for pre-only, green for post-only, type color for spanning sources
          const barColor = isPreOnly ? '#60a5fa' : isPostOnly ? '#34d399' : meta.color;

          return (
            <div key={src.id} className="flex items-center gap-3">
              <div className="w-36 shrink-0 truncate text-xs text-slate-400" title={src.name}>
                <span className="mr-1">{meta.icon}</span>
                {src.name}
              </div>
              {/* Track with phase-colored background bands */}
              <div
                className="relative h-5 flex-1 rounded overflow-hidden"
                style={{
                  background: `linear-gradient(to right,
                    rgba(59,130,246,0.06) 0%, rgba(59,130,246,0.06) ${retireLeftPct}%,
                    rgba(16,185,129,0.06) ${retireLeftPct}%, rgba(16,185,129,0.06) 100%)`,
                }}
              >
                {/* Current-age marker */}
                <div
                  className="absolute top-0 h-full w-0.5 bg-sky-500/50"
                  style={{ left: toLeft(currentAge) }}
                />
                {/* Retirement-age marker — dashed, prominent */}
                <div
                  className="absolute top-0 h-full"
                  style={{
                    left:             toLeft(retirementAge),
                    width:            '2px',
                    background:       'repeating-linear-gradient(to bottom, #34d399 0, #34d399 4px, transparent 4px, transparent 7px)',
                    zIndex:           2,
                  }}
                />
                {/* Income bar */}
                <div
                  className="absolute top-0.5 h-4 rounded cursor-pointer transition-opacity"
                  style={{
                    left:            toLeft(rawStart),
                    width:           toWidth(rawStart, rawEnd),
                    backgroundColor: barColor,
                    opacity:         isHovered ? 1 : (isPreOnly ? 0.55 : 0.75),
                    outline:         isPreOnly ? `2px dashed ${barColor}` : 'none',
                    outlineOffset:   '-2px',
                    zIndex:          1,
                  }}
                  onMouseEnter={() => setHovered(src.id)}
                  onMouseLeave={() => setHovered(null)}
                  title={`${src.name}: ${formatCurrency(src.monthly_amount)}/mo${isPreOnly ? ' — pre-retirement only' : ''}`}
                />
              </div>
              <div className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-slate-300">
                {formatCurrency(src.monthly_amount)}/mo
              </div>
            </div>
          );
        })}
      </div>

      {/* Phase labels */}
      <div className="mt-3 ml-36 mr-24 flex text-xs text-slate-600 select-none" aria-hidden>
        <span
          className="text-sky-600/60 font-medium"
          style={{ width: `${retireLeftPct}%`, textAlign: 'center', overflow: 'hidden' }}
        >
          ◀ pre-retirement
        </span>
        <span
          className="text-emerald-600/60 font-medium"
          style={{ flex: 1, textAlign: 'center', overflow: 'hidden' }}
        >
          post-retirement ▶
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-0.5 bg-sky-500/60" /> Now (age {currentAge})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-emerald-400/70" style={{ background: 'repeating-linear-gradient(to bottom,#34d399 0,#34d399 3px,transparent 3px,transparent 5px)' }} />
          Retirement (age {retirementAge})
        </span>
        {activeSources.some((s) => s.ends_at_retirement) && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-6 rounded-sm border border-sky-400/50" /> Pre-only (dashed)
          </span>
        )}
      </div>
    </div>
  );
}

// ─── INCOME CARD ─────────────────────────────────────────────────────────────

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium tabular-nums text-slate-200">{value}</div>
    </div>
  );
}

function IncomeCard({ src, currentAge, retirementAge, onEdit, onDelete, onToggle }) {
  const meta = rtMeta(src.income_type);
  const [delConfirm, setDelConfirm] = useState(false);

  return (
    <div className={`rounded-lg border px-4 py-3 transition-opacity ${
      src.is_active ? 'border-slate-700 bg-slate-800/50' : 'border-slate-800 bg-slate-900/40 opacity-50'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg leading-none shrink-0">{meta.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-slate-100 truncate">{src.name}</span>
              {src.isCurrentlyActive && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400 shrink-0">
                  Active
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span>{startLabel(src)} → {endLabel(src, retirementAge)}</span>
              {src.ends_at_retirement && (
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-400">
                  Pre-retirement only
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <IncludeToggle
            included={src.is_active}
            onToggle={(val) => onToggle(src, val)}
          />
          <button type="button" onClick={() => onEdit(src)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-300" title="Edit">
            <Pencil size={14} />
          </button>
          {delConfirm ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onDelete(src.id)}
                className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-400/10">Confirm</button>
              <button type="button" onClick={() => setDelConfirm(false)}
                className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-700">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setDelConfirm(true)}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-700 hover:text-red-400" title="Delete">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Type-aware stats grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Monthly (net)" value={formatCurrency(src.monthly_amount)} />

        {/* Employment: gross if set */}
        {src.income_type === 'employment' && src.gross_monthly_amount > 0 && (
          <Stat label="Gross" value={formatCurrency(src.gross_monthly_amount)} />
        )}

        {/* SS: claiming age */}
        {src.income_type === 'social_security' && src.start_age && (
          <Stat label="Claiming age" value={`Age ${src.start_age}`} />
        )}

        {/* Pension: survivor benefit */}
        {src.income_type === 'pension' && src.survivor_benefit_pct != null && (
          <Stat label="Survivor benefit" value={`${src.survivor_benefit_pct}%`} />
        )}

        {/* Retirement projection */}
        {src.monthlyAtRetirement > 0 && src.monthlyAtRetirement !== src.monthly_amount && (
          <Stat label={`At age ${retirementAge}`} value={formatCurrency(src.monthlyAtRetirement)} />
        )}

        {/* COLA */}
        {src.annual_increase_pct > 0 && (
          <Stat label="COLA" value={`+${src.annual_increase_pct}%/yr`} />
        )}

        <Stat
          label="Tax"
          value={TAX_TREATMENTS.find((t) => t.value === src.tax_treatment)?.label || src.tax_treatment}
        />

        {src.notes && (
          <div className="col-span-2 mt-1 text-xs text-slate-500 sm:col-span-3 lg:col-span-4">
            {src.notes}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── INCOME MODAL (type-aware, single-page) ───────────────────────────────────

function IncomeModal({ initial, defaultType, onClose, onSaved }) {
  const initType = initial?.income_type || defaultType || 'social_security';
  const [form,  setForm]  = useState(() => initial ? formFromSrc(initial) : emptyForType(initType));
  const [error, setError] = useState('');

  const queryClient = useQueryClient();
  const isEditing   = !!initial?.id;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload(form);
      return initial?.id
        ? apiClient.put(`/recurring-income/${initial.id}`, payload)
        : apiClient.post('/recurring-income', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-income-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-summary'] });
      onSaved();
    },
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save'),
  });

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target?.value ?? e }));

  const setBool = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.checked }));

  const handleTypeChange = (newType) => {
    if (form.income_type === newType) return;
    setForm((prev) => {
      const fresh = emptyForType(newType);
      // Preserve name and amounts when switching type
      return {
        ...fresh,
        name:                 prev.name,
        monthly_amount:       prev.monthly_amount,
        gross_monthly_amount: prev.gross_monthly_amount,
        notes:                prev.notes,
      };
    });
  };

  const canSave = form.name.trim() && form.monthly_amount !== '' && Number(form.monthly_amount) >= 0;

  const typeMeta = rtMeta(form.income_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl max-h-[90vh]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-100">
            {isEditing ? (
              <><span className="mr-2">{typeMeta.icon}</span>Edit {typeMeta.label}</>
            ) : 'Add Income Source'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        {/* Type chips */}
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-800 px-5 py-3">
          {RECURRING_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => handleTypeChange(t.value)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                form.income_type === t.value
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <TypeFields form={form} set={set} setBool={setBool} />

          {error && (
            <div className="flex items-center gap-2 rounded-md bg-red-400/10 px-3 py-2 text-sm text-red-400">
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-800 px-6 py-4">
          <button type="button" onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-300">
            Cancel
          </button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !canSave}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Income Source'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── SUMMARY CARD ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, suffix, highlight, dim }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${
        highlight ? 'text-sky-300' : dim ? 'text-slate-600' : 'text-slate-100'
      }`}>
        {formatCurrency(value)}
        <span className="text-sm font-normal text-slate-500">{suffix}</span>
      </div>
    </Card>
  );
}

// ─── classify source into pre / post retirement sections ─────────────────────

function classifySource(src, currentAge, retireAge) {
  // Resolve start age: 'now' → already active; 'age' → explicit; 'date' → treat as active
  const startAge = src.start_type === 'now'  ? 0
    : src.start_type === 'age' ? (Number(src.start_age) || 0)
    : 0;  // date-based: assume active

  const endsAtRetire = Boolean(src.ends_at_retirement);

  // End age: explicit age, or null (lifetime/unknown)
  const endAge = endsAtRetire ? retireAge
    : src.end_type === 'age' ? (Number(src.end_age) || null)
    : null;

  // isPre: currently active (started, not yet ended)
  const isPre = startAge <= currentAge && (
    endsAtRetire
      ? currentAge < retireAge          // employment: active now, stops at retirement
      : (endAge === null || endAge > currentAge)
  );

  // isPost: not ends-at-retirement AND extends into/through retirement
  const isPost = !endsAtRetire && (endAge === null || endAge > retireAge);

  return { isPre, isPost };
}

// ─── INCOME SECTION (themed pre/post container) ───────────────────────────────

function IncomeSection({
  title, subtitle, theme, sources,
  totalNet, totalLabel,
  currentAge, retirementAge,
  onAdd, onEdit, onDelete, onToggle,
}) {
  const isBlue = theme === 'blue';
  const c = isBlue ? {
    wrap:    'border-sky-500/20 bg-sky-500/[0.04]',
    title:   'text-sky-300',
    total:   'text-sky-300',
    addBtn:  'border-sky-500/30 text-sky-500 hover:bg-sky-500/10 hover:text-sky-400',
    empty:   'text-sky-500/70',
    divider: 'border-sky-500/15',
  } : {
    wrap:    'border-emerald-500/20 bg-emerald-500/[0.04]',
    title:   'text-emerald-300',
    total:   'text-emerald-300',
    addBtn:  'border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400',
    empty:   'text-emerald-500/70',
    divider: 'border-emerald-500/15',
  };

  return (
    <div className={`rounded-xl border ${c.wrap} px-5 py-4`}>
      {/* Section header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className={`text-sm font-semibold ${c.title}`}>{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className={`flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${c.addBtn}`}
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {/* Source cards */}
      {sources.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-600">
          No sources added yet.{' '}
          <button type="button" onClick={onAdd} className={`${c.empty} hover:underline`}>
            Add one →
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((src) => (
            <IncomeCard
              key={src.id}
              src={src}
              currentAge={currentAge}
              retirementAge={retirementAge}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}

      {/* Section total */}
      {sources.length > 0 && (
        <div className={`mt-3 pt-3 border-t ${c.divider} flex items-center justify-between`}>
          <span className="text-xs text-slate-500">{totalLabel}</span>
          <span className={`text-sm font-semibold tabular-nums ${c.total}`}>
            {formatCurrency(totalNet)}/mo net
          </span>
        </div>
      )}
    </div>
  );
}

// ─── GAP CALCULATOR (retirement readiness panel) ──────────────────────────────

function GapCalculator({ data, retirementAge }) {
  if (!data || !data.monthlySpendingGoal) return null;

  const {
    isOnTrack, monthlySpendingGoal, guaranteedMonthlyIncome,
    monthlyGap, portfolioNeeded, portfolioProjectedAtRetirement,
    surplusOrDeficit, withdrawalRate, monthlyFromPortfolio,
    totalMonthlyAtRetirement,
  } = data;

  return (
    <div className={`rounded-xl border p-5 ${
      isOnTrack ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                : 'border-rose-500/20 bg-rose-500/[0.04]'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">🎯</span>
          <h3 className="font-semibold text-slate-100">Retirement Readiness</h3>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          isOnTrack ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-rose-500/15 text-rose-400'
        }`}>
          {isOnTrack ? '✅ On Track' : '⚠️ Gap Exists'}
        </span>
      </div>

      {/* Monthly waterfall */}
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Monthly spending goal</span>
          <span className="font-medium tabular-nums text-slate-200">{formatCurrency(monthlySpendingGoal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Guaranteed income</span>
          <span className="tabular-nums text-emerald-400">−{formatCurrency(guaranteedMonthlyIncome)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-700/60 pt-2 font-medium">
          <span className="text-slate-300">Monthly gap (from portfolio)</span>
          <span className={`tabular-nums ${monthlyGap > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {monthlyGap > 0 ? formatCurrency(monthlyGap) : '✓ None'}
          </span>
        </div>
      </div>

      {/* Portfolio check */}
      <div className="mt-4 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Portfolio needed ({withdrawalRate}% rule)</span>
          <span className="tabular-nums text-slate-400">{formatCurrency(portfolioNeeded)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Portfolio at retirement (est.)</span>
          <span className="tabular-nums font-medium text-slate-200">{formatCurrency(portfolioProjectedAtRetirement)}</span>
        </div>
        <div className={`flex justify-between border-t border-slate-700/60 pt-2 font-semibold ${
          isOnTrack ? 'text-emerald-400' : 'text-rose-400'
        }`}>
          <span>{isOnTrack ? 'Surplus' : 'Shortfall'}</span>
          <span className="tabular-nums">
            {isOnTrack ? '+' : ''}{formatCurrency(surplusOrDeficit)}
            {isOnTrack ? ' ✅' : ''}
          </span>
        </div>
      </div>

      {/* Total monthly breakdown */}
      <div className="mt-4 rounded-lg bg-slate-800/50 p-3.5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Total monthly at retirement
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-400">
            <span>Guaranteed income</span>
            <span className="tabular-nums">{formatCurrency(guaranteedMonthlyIncome)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Portfolio ({withdrawalRate}% rule)</span>
            <span className="tabular-nums">{formatCurrency(monthlyFromPortfolio)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-700 pt-2 font-bold text-slate-100">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(totalMonthlyAtRetirement)}/mo</span>
          </div>
        </div>
      </div>

      {/* Not-on-track suggestions */}
      {!isOnTrack && (
        <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm">
          <div className="mb-1.5 font-medium text-rose-400">Suggestions to close the gap:</div>
          <ul className="space-y-1 text-slate-400">
            <li>• Increase savings rate or reduce spending</li>
            <li>• Delay retirement 1–3 years to grow the portfolio</li>
            <li>• Add a guaranteed income source (annuity, pension)</li>
          </ul>
        </div>
      )}

      <div className="mt-3 text-center">
        <a href="/retirement" className="text-xs text-sky-400 hover:underline">
          Adjust in Retirement Settings →
        </a>
      </div>
    </div>
  );
}

// ─── RECURRING SOURCES TAB ────────────────────────────────────────────────────

function RecurringSourcesTab() {
  const pid         = useActiveProfile();
  const queryClient = useQueryClient();

  // modal: null=closed | { defaultType } = creating | src-object = editing
  const [modal, setModal] = useState(null);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-income-summary'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ src, included }) =>
      apiClient.patch(`/recurring-income/${src.id}/toggle`, { included }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-income-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-summary'] });
    },
  });

  const sources    = sourcesQuery.data || [];
  const summary    = summaryQuery.data;
  const currentAge = summary?.currentAge    || 62;
  const retireAge  = summary?.retirementAge || 67;
  const yearsLeft  = summary?.yearsToRetirement ?? Math.max(0, retireAge - currentAge);

  // Classify every source into pre / post (or both) sections
  const { preSources, postSources } = useMemo(() => ({
    preSources:  sources.filter((s) => classifySource(s, currentAge, retireAge).isPre),
    postSources: sources.filter((s) => classifySource(s, currentAge, retireAge).isPost),
  }), [sources, currentAge, retireAge]);

  const activeSources = sources.filter((s) => s.is_active);
  const excludedCount = sources.filter((s) => !s.is_active).length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
    queryClient.invalidateQueries({ queryKey: ['recurring-income-summary'] });
    setModal(null);
  };

  const modalInitial = modal?.id        ? modal                                       : null;
  const modalDefault = modal?.defaultType || modal?.income_type || 'social_security';
  const isLoading    = sourcesQuery.isLoading || summaryQuery.isLoading;

  return (
    <>
      {/* ── Header summary bar ─────────────────────────────────────────────── */}
      {isLoading ? (
        <Card className="p-5"><Skeleton className="h-14 w-full" /></Card>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-8">
              {/* Today */}
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Today</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums text-slate-100">
                    {formatCurrency(summary?.preRetirement?.totalMonthlyNet ?? summary?.currentMonthly ?? 0)}
                  </span>
                  <span className="text-sm text-slate-500">/mo net</span>
                </div>
              </div>
              {/* At retirement */}
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  At Retirement (age {retireAge})
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums text-emerald-300">
                    {formatCurrency(summary?.gapCalculator?.totalMonthlyAtRetirement ?? summary?.atRetirement?.monthly ?? 0)}
                  </span>
                  <span className="text-sm text-slate-500">/mo total</span>
                </div>
              </div>
            </div>
            {yearsLeft > 0 && (
              <div className="text-center">
                <div className="text-3xl font-bold tabular-nums text-sky-300">{yearsLeft}</div>
                <div className="text-xs text-slate-500">years to retirement</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Timeline ──────────────────────────────────────────────────────── */}
      {!isLoading && activeSources.length > 0 && (
        <Card>
          <IncomeTimeline sources={activeSources} currentAge={currentAge} retirementAge={retireAge} />
        </Card>
      )}
      {isLoading && <Card><Skeleton className="h-32 w-full" /></Card>}

      {/* ── Section 1: Pre-Retirement ─────────────────────────────────────── */}
      {isLoading ? (
        <Card><Skeleton className="h-28 w-full" /></Card>
      ) : (
        <IncomeSection
          title="Pre-Retirement Income"
          subtitle={`Active now · ends at or before retirement (age ${retireAge})`}
          theme="blue"
          sources={preSources}
          totalNet={summary?.preRetirement?.totalMonthlyNet ?? 0}
          totalLabel="Total pre-retirement income"
          currentAge={currentAge}
          retirementAge={retireAge}
          onAdd={() => setModal({ defaultType: 'employment' })}
          onEdit={(s) => setModal(s)}
          onDelete={(id) => deleteMutation.mutate(id)}
          onToggle={(s, included) => toggleMutation.mutate({ src: s, included })}
        />
      )}

      {/* ── Section 2: Post-Retirement ────────────────────────────────────── */}
      {isLoading ? (
        <Card><Skeleton className="h-28 w-full" /></Card>
      ) : (
        <IncomeSection
          title="Post-Retirement Income"
          subtitle={`Starts at or continues through retirement (age ${retireAge})`}
          theme="green"
          sources={postSources}
          totalNet={summary?.postRetirement?.totalMonthlyNet ?? 0}
          totalLabel="Total guaranteed at retirement"
          currentAge={currentAge}
          retirementAge={retireAge}
          onAdd={() => setModal({ defaultType: 'social_security' })}
          onEdit={(s) => setModal(s)}
          onDelete={(id) => deleteMutation.mutate(id)}
          onToggle={(s, included) => toggleMutation.mutate({ src: s, included })}
        />
      )}

      {/* ── Section 3: Gap Calculator ─────────────────────────────────────── */}
      {!isLoading && summary?.gapCalculator && (
        <GapCalculator data={summary.gapCalculator} retirementAge={retireAge} />
      )}

      {/* ── Excluded-source notice ────────────────────────────────────────── */}
      {excludedCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-400">
          <AlertCircle size={14} className="shrink-0" />
          {excludedCount} source{excludedCount > 1 ? 's' : ''} excluded from projections (what-if scenario).
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {modal !== null && (
        <IncomeModal
          initial={modalInitial}
          defaultType={modalDefault}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}

// ─── INVESTMENT INCOME TAB (preserved) ───────────────────────────────────────

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
    event_date:    new Date().toISOString().slice(0, 10),
    event_type:    'dividend',
    amount:        '',
    account_id:    '',
    symbol:        '',
    description:   '',
    tax_treatment: 'taxable',
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
          <Button className="w-full" onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.amount || !form.event_date}>
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
    onSuccess: () => {
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
            <div className="mt-1 text-2xl font-semibold text-slate-100">
              {formatCurrency(summary?.ytd?.total || 0)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-400">Last 12 Months</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">
              {formatCurrency(summary?.trailing12?.total || 0)}
            </div>
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
                  {e.symbol      && <span className="font-mono text-xs text-slate-500">{e.symbol}</span>}
                  {e.account_name && <span className="truncate text-xs text-slate-500">{e.account_name}</span>}
                  <span className="ml-auto font-medium text-slate-100">{formatCurrency(e.amount)}</span>
                  <button type="button" className="text-slate-500 hover:text-red-400" title="Delete"
                    onClick={() => deleteMutation.mutate(e.id)}>
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
  { id: 'recurring',  label: 'Recurring Sources', icon: RefreshCw  },
  { id: 'investment', label: 'Investment Income',  icon: TrendingUp },
];

export default function Income() {
  const [tab, setTab] = useState('recurring');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-100">Income</h2>
        <p className="mt-1 text-sm text-slate-500">
          Track recurring income streams and investment income to model your retirement cash flow.
        </p>
      </div>

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

      {tab === 'recurring'  && <RecurringSourcesTab />}
      {tab === 'investment' && <InvestmentIncomeTab />}
    </div>
  );
}
