import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import apiClient from '../api/client';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { formatCurrency } from '../lib/accountTypes';

const DEFAULTS = {
  targetAnnualIncome: '80000',
  ssMonthly: '2000',
  retirementYears: '30',
  expectedReturn: '5',
  targetDate: '',
};

// Present value of an annuity: the nest egg that funds `netAnnual` withdrawals
// for `years` while the remaining balance earns `rate`.
function computeNestEgg({ netAnnual, years, rate }) {
  if (netAnnual <= 0) return 0;
  if (years <= 0) return 0;
  if (rate <= 0) return netAnnual * years;
  return netAnnual * (1 - (1 + rate) ** -years) / rate;
}

function Field({ id, label, hint, ...inputProps }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-slate-400" htmlFor={id}>{label}</label>
      <Input id={id} {...inputProps} />
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default function Goal() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(DEFAULTS);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const goalQuery = useQuery({
    queryKey: ['goal'],
    queryFn: async () => (await apiClient.get('/goals')).data,
  });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await apiClient.get('/accounts')).data,
  });

  // Prefill the calculator from the saved goal once it loads
  useEffect(() => {
    const goal = goalQuery.data;
    if (!goal) return;
    setForm({
      targetAnnualIncome: goal.target_annual_income != null ? String(Number(goal.target_annual_income)) : DEFAULTS.targetAnnualIncome,
      ssMonthly: goal.ss_monthly != null ? String(Number(goal.ss_monthly)) : DEFAULTS.ssMonthly,
      retirementYears: goal.retirement_years != null ? String(goal.retirement_years) : DEFAULTS.retirementYears,
      expectedReturn: goal.expected_return != null ? String(Number(goal.expected_return) * 100) : DEFAULTS.expectedReturn,
      targetDate: goal.target_date ? String(goal.target_date).slice(0, 10) : '',
    });
  }, [goalQuery.data]);

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const income = Number(form.targetAnnualIncome) || 0;
  const ssMonthly = Number(form.ssMonthly) || 0;
  const years = Number(form.retirementYears) || 0;
  const returnPct = Number(form.expectedReturn) || 0;

  const netAnnual = Math.max(0, income - ssMonthly * 12);
  const nestEgg = useMemo(
    () => computeNestEgg({ netAnnual, years, rate: returnPct / 100 }),
    [netAnnual, years, returnPct]
  );

  const currentTotal = (accountsQuery.data || []).reduce((sum, a) => sum + Number(a.balance), 0);

  const saveMutation = useMutation({
    mutationFn: async () => apiClient.post('/goals', {
      targetAmount: Math.round(nestEgg),
      targetAnnualIncome: income,
      retirementYears: years,
      expectedReturn: returnPct / 100,
      ssMonthly,
      targetDate: form.targetDate || null,
    }),
    onSuccess: () => {
      setError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['goal'] });
    },
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save goal'),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-2xl font-semibold">Retirement Goal</h2>

      <Card>
        <h3 className="mb-4 text-lg font-semibold">Calculator</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            id="goal-income"
            label="Desired annual income in retirement ($)"
            type="number"
            min="0"
            step="1000"
            value={form.targetAnnualIncome}
            onChange={set('targetAnnualIncome')}
          />
          <Field
            id="goal-ss"
            label="Social Security / pension ($ per month)"
            hint="Income you expect that doesn't come from savings"
            type="number"
            min="0"
            step="100"
            value={form.ssMonthly}
            onChange={set('ssMonthly')}
          />
          <Field
            id="goal-years"
            label="Years in retirement"
            type="number"
            min="1"
            max="60"
            step="1"
            value={form.retirementYears}
            onChange={set('retirementYears')}
          />
          <Field
            id="goal-return"
            label="Expected return during retirement (% per year)"
            hint="Real (after-inflation) return keeps the answer in today's dollars"
            type="number"
            min="0"
            max="20"
            step="0.1"
            value={form.expectedReturn}
            onChange={set('expectedReturn')}
          />
          <Field
            id="goal-date"
            label="Target retirement date (optional)"
            type="date"
            value={form.targetDate}
            onChange={set('targetDate')}
          />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">Nest egg needed</div>
            <div className="text-4xl font-semibold text-slate-100">{formatCurrency(nestEgg)}</div>
            <p className="mt-2 max-w-md text-sm text-slate-400">
              Covers {formatCurrency(netAnnual)}/year from savings
              ({formatCurrency(income)} income − {formatCurrency(ssMonthly * 12)} SS/pension)
              for {years} years at {returnPct}% return.
            </p>
            {currentTotal > 0 && nestEgg > 0 ? (
              <p className="mt-1 text-sm text-slate-400">
                You're at <span className="font-medium text-slate-200">{((currentTotal / nestEgg) * 100).toFixed(1)}%</span>{' '}
                ({formatCurrency(currentTotal)} of {formatCurrency(nestEgg)}).
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || nestEgg <= 0}>
              {saveMutation.isPending ? 'Saving...' : 'Save as Goal'}
            </Button>
            {saved ? <p className="mt-1 text-sm text-emerald-400">Goal saved</p> : null}
            {error ? <p className="mt-1 text-sm text-red-400">{error}</p> : null}
          </div>
        </div>
      </Card>

      {goalQuery.data ? (
        <p className="text-sm text-slate-500">
          Current saved goal: {formatCurrency(goalQuery.data.target_amount)}
          {goalQuery.data.target_date ? ` by ${new Date(goalQuery.data.target_date).toLocaleDateString('en-US', { timeZone: 'UTC' })}` : ''}.
          Saving again replaces it.
        </p>
      ) : null}
    </div>
  );
}
