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

import apiClient from '../api/client';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { useActiveProfile } from '../store/useActiveProfile';
import { Input } from '../components/ui/input';
import Skeleton from '../components/shared/Skeleton';
import { formatCurrency } from '../lib/accountTypes';

// Income type identity colors — validated categorical steps on slate-900
const INCOME_TYPES = [
  { value: 'dividend', label: 'Dividend', color: '#3987e5' },
  { value: 'interest', label: 'Interest', color: '#199e70' },
  { value: 'rental', label: 'Rental', color: '#d55181' },
  { value: 'capital_gain', label: 'Capital gain', color: '#c98500' },
  { value: 'other', label: 'Other', color: '#9085e9' },
];

const TAX_TREATMENTS = [
  { value: 'taxable', label: 'Taxable' },
  { value: 'tax_deferred', label: 'Tax-deferred' },
  { value: 'tax_free', label: 'Tax-free' },
];

function typeMeta(value) {
  return INCOME_TYPES.find((t) => t.value === value) || INCOME_TYPES[INCOME_TYPES.length - 1];
}

function formatMonth(month) {
  const [y, m] = String(month).split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('en-US', {
    month: 'short', timeZone: 'UTC',
  });
}

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

function AddIncomeForm({ accounts, onSaved }) {
  const [form, setForm] = useState({
    event_date: new Date().toISOString().slice(0, 10),
    event_type: 'dividend',
    amount: '',
    account_id: '',
    symbol: '',
    description: '',
    tax_treatment: 'taxable',
  });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const saveMutation = useMutation({
    mutationFn: async () => apiClient.post('/income', {
      ...form,
      account_id: form.account_id || null,
      amount: Number(form.amount),
    }),
    onSuccess: () => {
      setError('');
      setForm((prev) => ({ ...prev, amount: '', symbol: '', description: '' }));
      onSaved();
    },
    onError: (err) => setError(err?.response?.data?.error || 'Failed to add income'),
  });

  const selectClass = 'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none';

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Add Income Event</h3>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="inc-date">Date</label>
          <Input id="inc-date" type="date" value={form.event_date} onChange={set('event_date')} />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="inc-type">Type</label>
          <select id="inc-type" className={selectClass} value={form.event_type} onChange={set('event_type')}>
            {INCOME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="inc-amount">Amount ($)</label>
          <Input id="inc-amount" type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="inc-account">Account</label>
          <select id="inc-account" className={selectClass} value={form.account_id} onChange={set('account_id')}>
            <option value="">(none)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name || a.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="inc-symbol">Symbol (optional)</label>
          <Input id="inc-symbol" value={form.symbol} onChange={set('symbol')} placeholder="VTI" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="inc-desc">Description (optional)</label>
          <Input id="inc-desc" value={form.description} onChange={set('description')} />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="inc-tax">Tax treatment</label>
          <select id="inc-tax" className={selectClass} value={form.tax_treatment} onChange={set('tax_treatment')}>
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
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
    </Card>
  );
}

export default function Income() {
  const queryClient = useQueryClient();
  const pid = useActiveProfile();

  const summaryQuery = useQuery({
    queryKey: ['income-summary', pid],
    queryFn: async () => (await apiClient.get('/income/summary')).data,
  });
  const eventsQuery = useQuery({
    queryKey: ['income-events', pid],
    queryFn: async () => (await apiClient.get('/income')).data,
  });
  const accountsQuery = useQuery({
    queryKey: ['accounts', pid],
    queryFn: async () => (await apiClient.get('/accounts')).data,
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

  const summary = summaryQuery.data;
  const events = eventsQuery.data || [];
  const accounts = (accountsQuery.data || []).filter((a) => !a.archived_at);

  const chartData = useMemo(() => {
    if (!summary) return [];
    return summary.ytd.byMonth.map((m) => ({
      month: formatMonth(m.month),
      dividend: m.dividend || 0,
      interest: m.interest || 0,
      rental: m.rental || 0,
      capital_gain: m.capital_gain || 0,
      other: m.other || 0,
    }));
  }, [summary]);

  const activeTypes = useMemo(
    () => INCOME_TYPES.filter((t) => chartData.some((m) => m[t.value] > 0)),
    [chartData]
  );

  const hasAnyIncome = events.length > 0 || (summary?.ytd?.total || 0) > 0;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Income</h2>

      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-4"><Skeleton className="h-5 w-24" /><Skeleton className="mt-2 h-8 w-32" /></Card>
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
            <div className="mt-1 text-2xl font-semibold text-slate-100">{formatCurrency(summary?.projected?.annual || 0)}<span className="text-sm font-normal text-slate-500">/yr</span></div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-slate-400">Monthly Average</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100">{formatCurrency(summary?.projected?.monthly || 0)}<span className="text-sm font-normal text-slate-500">/mo</span></div>
          </Card>
        </div>
      )}

      <AddIncomeForm accounts={accounts} onSaved={refresh} />

      {!summaryQuery.isLoading && !hasAnyIncome ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-400">
            No income recorded yet. Add dividends, interest, or rental income above to start tracking.
          </p>
        </Card>
      ) : null}

      {chartData.length > 0 ? (
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
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} /> {t.label}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {(summary?.byAccount?.length || 0) > 0 ? (
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
                      {TAX_TREATMENTS.find((t) => t.value === row.taxTreatment)?.label || row.taxTreatment}
                    </td>
                    <td className="py-1.5 text-right font-mono">{formatCurrency(row.ytdTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {events.length > 0 ? (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Recent Income Events</h3>
          <div className="space-y-1.5 text-sm">
            {events.slice(0, 25).map((e) => {
              const meta = typeMeta(e.event_type);
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-md border border-slate-800 px-3 py-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                  <span className="text-slate-300">{new Date(e.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
                  <span className="text-slate-400">{meta.label}</span>
                  {e.symbol ? <span className="font-mono text-xs text-slate-500">{e.symbol}</span> : null}
                  {e.account_name ? <span className="truncate text-xs text-slate-500">{e.account_name}</span> : null}
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
      ) : null}
    </div>
  );
}
