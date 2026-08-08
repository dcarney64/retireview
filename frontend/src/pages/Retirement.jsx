import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
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
import { useActiveProfile } from '../store/useActiveProfile';

const CARD_SURFACE = '#0f172a';
// Cycle for newly created scenarios (validated categorical steps on slate-900)
const SCENARIO_COLORS = ['#6366f1', '#199e70', '#c98500', '#d55181', '#3987e5', '#9085e9'];

const EDITOR_FIELDS = [
  'name', 'current_age', 'retirement_age', 'life_expectancy', 'starting_portfolio',
  'pre_retirement_return', 'post_retirement_return', 'inflation_rate',
  'social_security_monthly', 'social_security_start_age', 'pension_monthly',
  'rental_income_monthly', 'other_income_monthly',
  'withdrawal_rate', 'withdrawal_type', 'fixed_withdrawal_amount', 'annual_spending_goal',
  'include_spouse', 'spouse_ss_monthly', 'spouse_ss_age', 'spouse_pension_monthly', 'spouse_retirement_age',
];

function scenarioToForm(scenario) {
  const form = {};
  for (const field of EDITOR_FIELDS) {
    const v = scenario?.[field];
    if (field === 'include_spouse') {
      form[field] = v === true;
    } else {
      form[field] = v == null ? '' : String(field === 'name' || field === 'withdrawal_type' ? v : Number(v));
    }
  }
  if (!form.withdrawal_type) form.withdrawal_type = 'percentage';
  return form;
}

function formToPayload(form) {
  const payload = {};
  for (const field of EDITOR_FIELDS) {
    if (field === 'name') payload.name = form.name;
    else if (field === 'withdrawal_type') payload.withdrawal_type = form.withdrawal_type;
    else if (field === 'include_spouse') payload.include_spouse = form.include_spouse === true;
    else payload[field] = form[field] === '' ? null : Number(form[field]);
  }
  return payload;
}

function NumField({ id, label, value, onChange, suffix, hint, ...props }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-slate-400" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" value={value} onChange={onChange} {...props} />
        {suffix ? <span className="shrink-0 text-sm text-slate-500">{suffix}</span> : null}
      </div>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm shadow-lg">
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: entry.stroke }} />
          <span className="text-slate-300">{entry.name}</span>
          <span className="ml-auto pl-3 font-medium text-slate-100">{formatCurrency(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Band colors: worst-to-best outcome bands on the fan chart
const BAND_RED = '#dc2626';
const BAND_AMBER = '#c98500';
const BAND_GREEN = '#199e70';

function FanChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const rows = [
    ['Best 10%', d.p90, BAND_GREEN],
    ['Top 25%', d.p75, BAND_GREEN],
    ['Median', d.p50, '#e2e8f0'],
    ['Bottom 25%', d.p25, BAND_AMBER],
    ['Worst 10%', d.p10, BAND_RED],
  ];
  return (
    <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm shadow-lg">
      <div className="mb-1 text-xs text-slate-400">Age {d.age} · {d.year}</div>
      {rows.map(([label, value, color]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="text-slate-300">{label}</span>
          <span className="ml-auto pl-3 font-medium text-slate-100">{formatCurrency(value)}</span>
        </div>
      ))}
    </div>
  );
}

function MonteCarloSection({ scenario }) {
  const mcQuery = useQuery({
    queryKey: ['monte-carlo', scenario.id, scenario.updated_at],
    queryFn: async () => (await apiClient.get(`/scenarios/${scenario.id}/monte-carlo`)).data,
    enabled: false,
    staleTime: Infinity,
  });

  const mc = mcQuery.data;
  const lifeExpectancy = Number(scenario.life_expectancy) || 90;
  const retirementAge = Number(scenario.retirement_age) || 67;

  const fanData = useMemo(() => {
    if (!mc) return [];
    // Stacked-diff encoding: each band area is the delta above the band below
    return mc.fanChartData.map((d) => ({
      ...d,
      base: d.p10,
      band1025: d.p25 - d.p10,
      band2575: d.p75 - d.p25,
      band7590: d.p90 - d.p75,
    }));
  }, [mc]);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">🎲 Monte Carlo Simulation</h3>
        <Button onClick={() => mcQuery.refetch()} disabled={mcQuery.isFetching}>
          {mcQuery.isFetching ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Running 1,000 simulations…
            </span>
          ) : mc ? 'Re-run Simulation' : 'Run Simulation'}
        </Button>
      </div>

      {mcQuery.isError ? (
        <p className="mt-4 text-sm text-red-400">Simulation failed — try again.</p>
      ) : null}

      {!mc && !mcQuery.isFetching ? (
        <p className="mt-4 text-sm text-slate-400">
          Runs 1,000 randomized market scenarios (12% annual volatility) against this plan to estimate
          how often your portfolio survives to age {lifeExpectancy}.
        </p>
      ) : null}

      {mc ? (
        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4 text-sm">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-slate-400">Success rate</span>
                <span className={`text-2xl font-semibold ${mc.successRate >= 90 ? 'text-emerald-400' : mc.successRate >= 75 ? 'text-amber-400' : 'text-red-400'}`}>
                  {mc.successRate}%
                </span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-slate-800" role="progressbar"
                aria-valuenow={Math.round(mc.successRate)} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={`h-full rounded-full ${mc.successRate >= 90 ? 'bg-emerald-500' : mc.successRate >= 75 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${mc.successRate}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                of simulations your portfolio lasts to age {lifeExpectancy}
              </p>
            </div>

            <div className="flex justify-between border-t border-slate-800 pt-3">
              <span className="text-slate-400">Median portfolio at age {lifeExpectancy}</span>
              <span className="font-medium text-slate-100">{formatCurrency(mc.medianEndValue)}</span>
            </div>

            <div>
              <div className="mb-1.5 text-slate-400">Outcome range at age {lifeExpectancy}</div>
              <div className="space-y-1">
                {[
                  ['Best 10%', mc.percentile90, BAND_GREEN, '+'],
                  ['Good 25%', mc.percentile75, BAND_GREEN, '+'],
                  ['Median', mc.percentile50, '#e2e8f0', ''],
                  ['Weak 25%', mc.percentile25, BAND_AMBER, ''],
                  ['Worst 10%', mc.percentile10, BAND_RED, ''],
                ].map(([label, value, color, suffix]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                    <span className="text-slate-400">{label}</span>
                    <span className="ml-auto font-mono text-slate-200">{formatCurrency(value)}{suffix}</span>
                  </div>
                ))}
              </div>
            </div>

            {Object.keys(mc.runsOutBefore).length > 0 ? (
              <div className="border-t border-slate-800 pt-3">
                <div className="mb-1.5 text-slate-400">Risk of running out</div>
                {Object.entries(mc.runsOutBefore).map(([key, pct]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-slate-400">Before age {key.replace('age', '')}</span>
                    <span className={pct > 10 ? 'text-red-400' : pct > 5 ? 'text-amber-400' : 'text-slate-200'}>
                      {pct}%
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={fanData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 12 }}
                    axisLine={{ stroke: '#334155' }} tickLine={false} minTickGap={25} />
                  <YAxis tickFormatter={(v) => formatCurrency(v, { compact: true })}
                    tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} width={65} />
                  <Tooltip content={<FanChartTooltip />} cursor={{ stroke: '#475569', strokeWidth: 1 }} />
                  <ReferenceLine x={retirementAge} stroke="#64748b" strokeDasharray="4 4"
                    label={{ value: 'Retire', fill: '#94a3b8', fontSize: 11, position: 'insideTopLeft' }} />
                  <Area dataKey="base" stackId="fan" stroke="none" fill="transparent" isAnimationActive={false} />
                  <Area dataKey="band1025" name="10–25%" stackId="fan" stroke="none"
                    fill={BAND_RED} fillOpacity={0.25} isAnimationActive={false} />
                  <Area dataKey="band2575" name="25–75%" stackId="fan" stroke="none"
                    fill={BAND_AMBER} fillOpacity={0.25} isAnimationActive={false} />
                  <Area dataKey="band7590" name="75–90%" stackId="fan" stroke="none"
                    fill={BAND_GREEN} fillOpacity={0.25} isAnimationActive={false} />
                  <Line dataKey="p50" name="Median" stroke="#e2e8f0" strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BAND_RED, opacity: 0.5 }} /> Worst 10–25%</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BAND_AMBER, opacity: 0.5 }} /> Middle 25–75%</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BAND_GREEN, opacity: 0.5 }} /> Best 75–90%</li>
              <li className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: '#e2e8f0' }} /> Median</li>
            </ul>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function riskLabel(successRate) {
  if (successRate >= 98) return ['Very Low', 'text-emerald-400'];
  if (successRate >= 95) return ['Low', 'text-emerald-400'];
  if (successRate >= 90) return ['Moderate', 'text-amber-400'];
  if (successRate >= 80) return ['High', 'text-amber-400'];
  return ['Very High', 'text-red-400'];
}

function SwrSection({ scenario }) {
  const queryClient = useQueryClient();
  const [sortBy, setSortBy] = useState({ key: 'rate', dir: 1 });
  const [applied, setApplied] = useState(false);

  const swrQuery = useQuery({
    queryKey: ['swr', scenario.id, scenario.updated_at],
    queryFn: async () => (await apiClient.get(`/scenarios/${scenario.id}/safe-withdrawal-rate`)).data,
    enabled: false,
    staleTime: Infinity,
  });
  const swr = swrQuery.data;

  const applyMutation = useMutation({
    mutationFn: async () => apiClient.put(`/scenarios/${scenario.id}`, {
      withdrawal_rate: swr.safeRate,
      withdrawal_type: 'percentage',
    }),
    onSuccess: () => {
      setApplied(true);
      setTimeout(() => setApplied(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      queryClient.invalidateQueries({ queryKey: ['projection'] });
    },
  });

  const sortedTable = useMemo(() => {
    if (!swr) return [];
    const keyMap = { rate: 'rate', success: 'successRate', income: 'monthlyIncome' };
    const key = keyMap[sortBy.key];
    return [...swr.rateTable].sort((a, b) => (a[key] - b[key]) * sortBy.dir);
  }, [swr, sortBy]);

  const toggleSort = (key) => setSortBy((prev) =>
    prev.key === key ? { key, dir: -prev.dir } : { key, dir: 1 });

  const sortArrow = (key) => (sortBy.key === key ? (sortBy.dir === 1 ? ' ▲' : ' ▼') : '');

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">🛡️ Safe Withdrawal Rate Analysis</h3>
        <Button onClick={() => swrQuery.refetch()} disabled={swrQuery.isFetching}>
          {swrQuery.isFetching ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Analyzing…
            </span>
          ) : swr ? 'Re-analyze' : 'Analyze'}
        </Button>
      </div>

      {swrQuery.isError ? (
        <p className="mt-4 text-sm text-red-400">Analysis failed — try again.</p>
      ) : null}

      {!swr && !swrQuery.isFetching ? (
        <p className="mt-4 text-sm text-slate-400">
          Finds the highest withdrawal rate that survives Monte Carlo testing, based on your portfolio
          at retirement ({'>'}95% success = safe).
        </p>
      ) : null}

      {swr ? (
        <div className="mt-5 space-y-5">
          <p className="text-sm text-slate-400">
            Based on a projected portfolio of{' '}
            <span className="text-slate-200">{formatCurrency(swr.portfolioAtRetirement)}</span> at retirement:
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              ['Conservative', '99% success', swr.conservativeRate, swr.conservativeMonthlyIncome],
              ['Safe', '95% success', swr.safeRate, swr.safeMonthlyIncome],
              ['Aggressive', '85% success', swr.aggressiveRate, swr.aggressiveMonthlyIncome],
            ].map(([label, sub, rate, income]) => (
              <div key={label} className={`rounded-lg border p-4 ${label === 'Safe' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800'}`}>
                <div className="text-sm text-slate-400">{label} <span className="text-xs text-slate-500">({sub})</span></div>
                <div className="mt-1 text-2xl font-semibold text-slate-100">{rate}%</div>
                <div className="text-sm text-slate-400">= {formatCurrency(income)}/mo</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-slate-400">
                  <th className="cursor-pointer py-2 pr-4 font-normal hover:text-slate-200" onClick={() => toggleSort('rate')}>
                    Rate{sortArrow('rate')}
                  </th>
                  <th className="cursor-pointer py-2 pr-4 font-normal hover:text-slate-200" onClick={() => toggleSort('success')}>
                    Success{sortArrow('success')}
                  </th>
                  <th className="cursor-pointer py-2 pr-4 text-right font-normal hover:text-slate-200" onClick={() => toggleSort('income')}>
                    Monthly Income{sortArrow('income')}
                  </th>
                  <th className="py-2 font-normal">Risk</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {sortedTable.map((row) => {
                  const [label, colorClass] = riskLabel(row.successRate);
                  const isSafe = row.rate === swr.safeRate;
                  return (
                    <tr key={row.rate} className={`border-b border-slate-800/40 ${isSafe ? 'bg-emerald-500/5' : ''}`}>
                      <td className="py-1.5 pr-4">{row.rate.toFixed(1)}%</td>
                      <td className="py-1.5 pr-4">{row.successRate}%</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{formatCurrency(row.monthlyIncome)}</td>
                      <td className={`py-1.5 ${colorClass}`}>{label}{isSafe ? ' ← Safe' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? 'Applying…' : `Use Safe Rate (${swr.safeRate}%) in Scenario`}
            </Button>
            {applied ? <span className="text-sm text-emerald-400">Scenario updated</span> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export default function Retirement() {
  const queryClient = useQueryClient();
  const pid = useActiveProfile();
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showRunway, setShowRunway] = useState(false);

  const scenariosQuery = useQuery({
    queryKey: ['scenarios', pid],
    queryFn: async () => (await apiClient.get('/scenarios')).data,
  });
  const accountsQuery = useQuery({
    queryKey: ['accounts', pid],
    queryFn: async () => (await apiClient.get('/accounts')).data,
  });
  const propertiesQuery = useQuery({
    queryKey: ['properties', pid],
    queryFn: async () => (await apiClient.get('/properties')).data,
  });
  const householdQuery = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await apiClient.get('/household')).data,
  });
  const recurringIncomeQuery = useQuery({
    queryKey: ['recurring-income', pid],
    queryFn: async () => (await apiClient.get('/recurring-income')).data,
  });
  const householdMembers = householdQuery.data || [];
  const firstSpouse = householdMembers.find((m) => m.relationship === 'spouse' || m.relationship === 'partner') || null;
  const recurringIncomeSources = recurringIncomeQuery.data || [];

  const scenarios = useMemo(() => scenariosQuery.data || [], [scenariosQuery.data]);

  const liquidTotal = useMemo(
    () => (accountsQuery.data || [])
      .filter((a) => a.include_in_tracking !== false && !a.archived_at)
      .reduce((s, a) => s + Number(a.balance), 0),
    [accountsQuery.data]
  );
  const rentalMonthly = propertiesQuery.data?.totals?.total_monthly_rental_income || 0;

  // Select the active scenario once loaded (or keep current selection)
  useEffect(() => {
    if (!scenarios.length) return;
    if (selectedId && scenarios.some((s) => s.id === selectedId)) return;
    const active = scenarios.find((s) => s.is_active) || scenarios[0];
    setSelectedId(active.id);
  }, [scenarios, selectedId]);

  const selected = scenarios.find((s) => s.id === selectedId) || null;

  // Sync the editor form whenever the selected scenario (re)loads
  useEffect(() => {
    if (selected) setForm(scenarioToForm(selected));
  }, [selectedId, selected?.updated_at]);

  const projectionQueries = useQueries({
    queries: scenarios.map((s) => ({
      queryKey: ['projection', s.id, s.updated_at, pid],
      queryFn: async () => (await apiClient.get(`/scenarios/${s.id}/projection`)).data,
      staleTime: 60_000,
    })),
  });
  const projections = useMemo(() => {
    const map = {};
    scenarios.forEach((s, i) => {
      if (projectionQueries[i]?.data) map[s.id] = projectionQueries[i].data;
    });
    return map;
  }, [scenarios, projectionQueries]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    queryClient.invalidateQueries({ queryKey: ['projection'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => apiClient.put(`/scenarios/${selectedId}`, formToPayload(form)),
    onSuccess: () => { setError(''); invalidate(); },
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save scenario'),
  });

  const createMutation = useMutation({
    mutationFn: async () => apiClient.post('/scenarios', {
      name: `Scenario ${scenarios.length + 1}`,
      color: SCENARIO_COLORS[scenarios.length % SCENARIO_COLORS.length],
      rental_income_monthly: rentalMonthly || undefined,
    }),
    onSuccess: (res) => { setSelectedId(res.data.id); invalidate(); },
    onError: (err) => setError(err?.response?.data?.error || 'Failed to create scenario'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/scenarios/${id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId(null);
      invalidate();
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id) => apiClient.post(`/scenarios/${id}/activate`),
    onSuccess: invalidate,
  });

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const projection = selectedId ? projections[selectedId] : null;
  const summary = projection?.summary;

  // Runway chart: one line per scenario, merged on year
  const runwayData = useMemo(() => {
    const byYear = new Map();
    for (const s of scenarios) {
      const proj = projections[s.id];
      if (!proj) continue;
      for (const row of proj.yearlyData) {
        if (!byYear.has(row.year)) byYear.set(row.year, { year: row.year, age: row.age });
        byYear.get(row.year)[s.id] = row.portfolioValue;
      }
    }
    return [...byYear.values()].sort((a, b) => a.year - b.year);
  }, [scenarios, projections]);

  const retirementYear = useMemo(() => {
    if (!projection) return null;
    const firstRetired = projection.yearlyData.find((r) => r.retired);
    return firstRetired?.year ?? null;
  }, [projection]);

  // retirementIncomeBreakdown is returned by the projection API in both modes:
  //   - useRecurringIncome=true → each row is a real recurring_income source
  //   - useRecurringIncome=false → built from the scenario's SS/pension/rental fields
  // In either case we get a [{name, type, monthly}] array + portfolioWithdrawal.
  const retirementIncomeBreakdown = summary?.retirementIncomeBreakdown ?? null;
  const portfolioWithdrawalMonthly = (() => {
    const first = projection?.yearlyData?.find((r) => r.retired);
    return first ? Math.round(first.withdrawalAmount / 12) : null;
  })();

  // Legacy flat object kept for any remaining conditional renders below
  const guaranteedMonthly = summary != null && projection
    ? (() => {
        const first = projection.yearlyData.find((r) => r.retired);
        return first
          ? {
              ss:           first.socialSecurity         / 12,
              pension:      first.pensionIncome           / 12,
              spouseSS:    (first.spouseSocialSecurity || 0) / 12,
              spousePension:(first.spousePension       || 0) / 12,
              rental:       first.rentalIncome            / 12,
              other:        first.otherIncome             / 12,
              otherAsset:  (first.otherAssetIncome     || 0) / 12,
              portfolio:    first.withdrawalAmount        / 12,
            }
          : null;
      })()
    : null;

  if (scenariosQuery.isLoading) {
    return <p className="py-12 text-center text-sm text-slate-400">Loading scenarios…</p>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Retirement</h2>

      {/* ── Scenario tabs ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {scenarios.map((s) => {
          const isSelected = s.id === selectedId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                isSelected
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: s.is_active ? s.color : 'transparent', border: `2px solid ${s.color}` }}
                title={s.is_active ? 'Active scenario' : ''}
              />
              {s.name}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex items-center gap-1 rounded-md border border-dashed border-slate-600 px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <Plus size={14} /> New
        </button>
      </div>

      {/* ── Scenario editor ───────────────────────────────────── */}
      {selected && form ? (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Input
                className="w-56 font-medium"
                value={form.name}
                onChange={set('name')}
                aria-label="Scenario name"
              />
              {selected.is_active ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">Active</span>
              ) : (
                <Button
                  className="bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
                  onClick={() => activateMutation.mutate(selected.id)}
                  disabled={activateMutation.isPending}
                >
                  Set Active
                </Button>
              )}
            </div>
            {scenarios.length > 1 ? (
              <button
                type="button"
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-400"
                onClick={() => setDeleteTarget(selected)}
              >
                <Trash2 size={14} /> Delete
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your Situation</h4>
              <NumField id="sc-age" label="Current age" min="18" max="100" value={form.current_age} onChange={set('current_age')} />
              <NumField id="sc-ret-age" label="Retirement age" min="30" max="100" value={form.retirement_age} onChange={set('retirement_age')} />
              <NumField id="sc-life" label="Life expectancy" min="50" max="120" value={form.life_expectancy} onChange={set('life_expectancy')} />
              <NumField
                id="sc-portfolio" label="Current portfolio ($)" min="0" step="1000"
                value={form.starting_portfolio} onChange={set('starting_portfolio')}
                hint={liquidTotal > 0 ? `Tracked accounts total ${formatCurrency(liquidTotal)}` : null}
              />
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assumptions</h4>
              <NumField id="sc-pre" label="Pre-retirement return" suffix="%" min="0" max="30" step="0.1"
                value={form.pre_retirement_return} onChange={set('pre_retirement_return')} />
              <NumField id="sc-post" label="Post-retirement return" suffix="%" min="0" max="30" step="0.1"
                value={form.post_retirement_return} onChange={set('post_retirement_return')} />
              <NumField id="sc-infl" label="Inflation rate" suffix="%" min="0" max="15" step="0.1"
                value={form.inflation_rate} onChange={set('inflation_rate')} />
              <NumField id="sc-spend" label="Annual spending goal ($)" min="0" step="1000"
                value={form.annual_spending_goal} onChange={set('annual_spending_goal')} />
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Income Sources</h4>

              {recurringIncomeSources.length > 0 ? (
                /* ── Recurring income sources from the Income page ── */
                (() => {
                  const retAge = Number(selected?.retirement_age) || 67;
                  const preRetire  = recurringIncomeSources.filter((s) => s.ends_at_retirement);
                  const postRetire = recurringIncomeSources.filter((s) => !s.ends_at_retirement);

                  const srcLabel = (src) => {
                    const start = src.start_type === 'now'
                      ? 'active now'
                      : src.start_type === 'age' && src.start_age
                        ? `starts age ${src.start_age}`
                        : src.start_date ?? '';
                    const end = src.ends_at_retirement
                      ? `ends at retirement`
                      : src.end_type === 'lifetime'
                        ? 'lifetime'
                        : src.end_type === 'age' && src.end_age
                          ? `ends age ${src.end_age}`
                          : src.end_type === 'years' && src.end_years
                            ? `${src.end_years}-yr certain`
                            : '';
                    return `${start}${end ? ` → ${end}` : ''}`;
                  };

                  const SrcRow = ({ src }) => (
                    <div
                      key={src.id}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                        src.is_active
                          ? 'border-slate-700 bg-slate-800/40'
                          : 'border-slate-800 opacity-40'
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-slate-200">{src.name}</span>
                        <span className="ml-2 text-xs text-slate-500">{srcLabel(src)}</span>
                      </div>
                      <span className="ml-3 shrink-0 font-medium tabular-nums text-slate-300">
                        {formatCurrency(src.monthly_amount)}/mo
                      </span>
                    </div>
                  );

                  return (
                    <div className="space-y-3">
                      {preRetire.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-amber-500/80">
                            Pre-retirement (ends at age {retAge})
                          </div>
                          {preRetire.map((src) => <SrcRow key={src.id} src={src} />)}
                        </div>
                      )}
                      {postRetire.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-500/80">
                            At &amp; after retirement
                          </div>
                          {postRetire.map((src) => <SrcRow key={src.id} src={src} />)}
                        </div>
                      )}
                      <Link
                        to="/income"
                        className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 hover:underline"
                      >
                        <ExternalLink size={11} /> Manage in Income page
                      </Link>
                    </div>
                  );
                })()
              ) : (
                /* ── Manual fallback when no recurring sources exist ── */
                <>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <NumField id="sc-ss" label="Social Security ($/mo)" min="0" step="100"
                      value={form.social_security_monthly} onChange={set('social_security_monthly')} />
                    <NumField id="sc-ss-age" label="From age" min="62" max="75"
                      value={form.social_security_start_age} onChange={set('social_security_start_age')} className="w-20" />
                  </div>
                  <NumField id="sc-pension" label="Pension ($/mo)" min="0" step="100"
                    value={form.pension_monthly} onChange={set('pension_monthly')} />
                  <NumField
                    id="sc-rental" label="Rental income ($/mo)" min="0" step="100"
                    value={form.rental_income_monthly} onChange={set('rental_income_monthly')}
                    hint={rentalMonthly > 0 ? `Properties currently generate ${formatCurrency(rentalMonthly)}/mo` : null}
                  />
                  <NumField id="sc-other" label="Other income ($/mo)" min="0" step="100"
                    value={form.other_income_monthly} onChange={set('other_income_monthly')} />
                  <Link
                    to="/income"
                    className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 hover:underline"
                  >
                    <ExternalLink size={11} /> Set up recurring income sources →
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* ── Spouse/Partner Income ──────────────────────── */}
          <div className="mt-6 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Spouse / Partner Income</h4>
              {firstSpouse && !form.include_spouse ? (
                <button
                  type="button"
                  className="text-xs text-sky-400 hover:text-sky-300 hover:underline"
                  onClick={() => {
                    setForm((prev) => ({
                      ...prev,
                      include_spouse: true,
                      spouse_ss_monthly: String(Number(firstSpouse.social_security_monthly) || 0),
                      spouse_ss_age: String(firstSpouse.social_security_age || 67),
                      spouse_pension_monthly: String(Number(firstSpouse.pension_monthly) || 0),
                      spouse_retirement_age: String(firstSpouse.retirement_age || 67),
                    }));
                  }}
                >
                  Import from {firstSpouse.name}
                </button>
              ) : null}
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.include_spouse === true}
                onChange={(e) => setForm((prev) => ({ ...prev, include_spouse: e.target.checked }))}
              />
              Include spouse/partner retirement income
            </label>

            {form.include_spouse ? (
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <NumField
                  id="sc-spouse-ss"
                  label="Spouse SS ($/mo)"
                  min="0" step="100"
                  value={form.spouse_ss_monthly}
                  onChange={set('spouse_ss_monthly')}
                />
                <NumField
                  id="sc-spouse-ss-age"
                  label="Spouse SS from age"
                  min="62" max="75"
                  value={form.spouse_ss_age}
                  onChange={set('spouse_ss_age')}
                />
                <NumField
                  id="sc-spouse-pension"
                  label="Spouse pension ($/mo)"
                  min="0" step="100"
                  value={form.spouse_pension_monthly}
                  onChange={set('spouse_pension_monthly')}
                />
                <NumField
                  id="sc-spouse-ret-age"
                  label="Spouse retirement age"
                  min="30" max="100"
                  value={form.spouse_retirement_age}
                  onChange={set('spouse_retirement_age')}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-6 border-t border-slate-800 pt-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Withdrawal Strategy</h4>
            <div className="space-y-2 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name="withdrawal-type"
                  checked={form.withdrawal_type === 'percentage'}
                  onChange={() => setForm((p) => ({ ...p, withdrawal_type: 'percentage' }))}
                />
                <span className="text-slate-300">Percentage withdrawal:</span>
                <Input
                  type="number" min="0" max="20" step="0.1" className="w-20 px-2 py-1"
                  value={form.withdrawal_rate} onChange={set('withdrawal_rate')}
                  aria-label="Withdrawal rate percent"
                />
                <span className="text-slate-500">% per year</span>
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name="withdrawal-type"
                  checked={form.withdrawal_type === 'fixed'}
                  onChange={() => setForm((p) => ({ ...p, withdrawal_type: 'fixed' }))}
                />
                <span className="text-slate-300">Fixed amount:</span>
                <Input
                  type="number" min="0" step="1000" className="w-32 px-2 py-1"
                  value={form.fixed_withdrawal_amount} onChange={set('fixed_withdrawal_amount')}
                  aria-label="Fixed withdrawal amount"
                />
                <span className="text-slate-500">$ per year</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="withdrawal-type"
                  checked={form.withdrawal_type === 'income_gap'}
                  onChange={() => setForm((p) => ({ ...p, withdrawal_type: 'income_gap' }))}
                />
                <span className="text-slate-300">
                  Income gap <span className="text-slate-500">(recommended)</span> — withdraw only what you need above guaranteed income
                </span>
              </label>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Calculating…' : 'Calculate'}
            </Button>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </div>
        </Card>
      ) : null}

      {/* ── Results ───────────────────────────────────────────── */}
      {summary ? (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">
            💰 {summary.includeSpouse ? 'Combined ' : ''}Estimated Monthly Income at Retirement
          </h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-1.5 text-sm">
              {/* Per-source breakdown — works in both recurring and legacy modes */}
              {retirementIncomeBreakdown?.map((item, i) => (
                item.monthly > 0 ? (
                  <div key={i} className="flex justify-between">
                    <span className="text-slate-400">{item.name}</span>
                    <span className="text-slate-100">{formatCurrency(item.monthly)}/mo</span>
                  </div>
                ) : null
              ))}
              {/* Portfolio withdrawal — always shown separately */}
              {portfolioWithdrawalMonthly != null && portfolioWithdrawalMonthly > 0 ? (
                <div className="flex justify-between">
                  <span className="text-slate-400">Portfolio withdrawal</span>
                  <span className="text-slate-100">{formatCurrency(portfolioWithdrawalMonthly)}/mo</span>
                </div>
              ) : null}
              {/* Legacy fallback: no breakdown available (shouldn't happen but safe) */}
              {!retirementIncomeBreakdown && guaranteedMonthly ? (
                <>
                  {guaranteedMonthly.ss > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Social Security</span>
                      <span className="text-slate-100">{formatCurrency(guaranteedMonthly.ss)}/mo</span>
                    </div>
                  )}
                  {guaranteedMonthly.portfolio > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Portfolio withdrawal</span>
                      <span className="text-slate-100">{formatCurrency(guaranteedMonthly.portfolio)}/mo</span>
                    </div>
                  )}
                </>
              ) : null}
              <div className="flex justify-between border-t border-slate-800 pt-2 font-medium">
                <span className="text-slate-200">Total monthly income</span>
                <span className="text-xl text-slate-100">{formatCurrency(summary.monthlyIncomeAtRetirement)}/mo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Annual income</span>
                <span className="text-slate-100">{formatCurrency(summary.monthlyIncomeAtRetirement * 12)}/yr</span>
              </div>
              {summary.usedRecurringIncome && (
                <Link
                  to="/income"
                  className="mt-1 flex items-center gap-1 text-xs text-sky-500 hover:text-sky-400 hover:underline"
                >
                  <ExternalLink size={10} /> Manage income sources
                </Link>
              )}
            </div>
            <div className="space-y-1.5 text-sm lg:border-l lg:border-slate-800 lg:pl-6">
              <div className="flex justify-between">
                <span className="text-slate-400">Portfolio at retirement</span>
                <span className="text-slate-100">{formatCurrency(summary.portfolioAtRetirement)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Portfolio at age {selected ? Number(selected.life_expectancy) || 90 : 90}</span>
                <span className="text-slate-100">{formatCurrency(summary.portfolioAtEndOfLife)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total lifetime income</span>
                <span className="text-slate-100">{formatCurrency(summary.totalLifetimeIncome)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Years of retirement</span>
                <span className="text-slate-100">{summary.yearsOfRetirement}</span>
              </div>
              <p className={`pt-2 font-medium ${summary.portfolioRunsOut ? 'text-red-400' : 'text-emerald-400'}`}>
                {summary.portfolioRunsOut
                  ? `⚠ Portfolio runs out in ${summary.portfolioRunsOut}`
                  : 'Portfolio never runs out ✅'}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ── Scenario comparison ───────────────────────────────── */}
      {scenarios.length >= 2 ? (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Scenario Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-slate-400">
                  <th className="py-2 pr-4 font-normal" />
                  {scenarios.map((s) => (
                    <th key={s.id} className="py-2 pr-4 font-medium text-slate-200">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-slate-300">
                <tr className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-400">Return assumed</td>
                  {scenarios.map((s) => (
                    <td key={s.id} className="py-2 pr-4">
                      {Number(s.pre_retirement_return)}% / {Number(s.post_retirement_return)}%
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-400">Monthly income</td>
                  {scenarios.map((s) => (
                    <td key={s.id} className="py-2 pr-4">
                      {projections[s.id] ? `${formatCurrency(projections[s.id].summary.monthlyIncomeAtRetirement)}/mo` : '…'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-400">Portfolio @ retirement</td>
                  {scenarios.map((s) => (
                    <td key={s.id} className="py-2 pr-4">
                      {projections[s.id] ? formatCurrency(projections[s.id].summary.portfolioAtRetirement) : '…'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-400">Portfolio @ end of life</td>
                  {scenarios.map((s) => (
                    <td key={s.id} className="py-2 pr-4">
                      {projections[s.id] ? formatCurrency(projections[s.id].summary.portfolioAtEndOfLife) : '…'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-slate-400">Runs out?</td>
                  {scenarios.map((s) => {
                    const runsOut = projections[s.id]?.summary?.portfolioRunsOut;
                    return (
                      <td key={s.id} className={`py-2 pr-4 ${runsOut ? 'text-red-400' : 'text-emerald-400'}`}>
                        {projections[s.id] ? (runsOut ? `In ${runsOut}` : 'Never') : '…'}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* ── Portfolio runway chart ────────────────────────────── */}
      {runwayData.length > 0 ? (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Portfolio Runway</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={runwayData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="year"
                  tick={{ fill: '#94a3b8', fontSize: 12 }}
                  axisLine={{ stroke: '#334155' }}
                  tickLine={false}
                  minTickGap={30}
                />
                <YAxis
                  tickFormatter={(v) => formatCurrency(v, { compact: true })}
                  tick={{ fill: '#94a3b8', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#475569', strokeWidth: 1 }} />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 4" />
                {retirementYear ? (
                  <ReferenceLine
                    x={retirementYear}
                    stroke="#64748b"
                    strokeDasharray="4 4"
                    label={{ value: 'Retirement', fill: '#94a3b8', fontSize: 11, position: 'insideTopRight' }}
                  />
                ) : null}
                {scenarios.map((s) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={s.id}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: CARD_SURFACE, strokeWidth: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
            {scenarios.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} /> {s.name}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── Monte Carlo + SWR ─────────────────────────────────── */}
      {selected ? <MonteCarloSection scenario={selected} /> : null}
      {selected ? <SwrSection scenario={selected} /> : null}

      {/* ── Year-by-year runway table ─────────────────────────── */}
      {projection ? (
        <Card>
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left text-lg font-semibold text-slate-100"
            onClick={() => setShowRunway((s) => !s)}
          >
            {showRunway ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            Year-by-Year Detail {selected ? `— ${selected.name}` : ''}
          </button>
          {showRunway ? (
            <div className="mt-4 max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="border-b border-slate-800 text-left text-slate-400">
                    <th className="py-2 pr-4 font-normal">Year</th>
                    <th className="py-2 pr-4 font-normal">Age</th>
                    <th className="py-2 pr-4 text-right font-normal">Portfolio</th>
                    <th className="py-2 pr-4 text-right font-normal">Monthly Income</th>
                    <th className="py-2 pr-4 text-right font-normal">Withdrawal</th>
                    <th className="py-2 text-right font-normal">Spending (infl-adj)</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {projection.yearlyData.map((row) => (
                    <tr
                      key={row.year}
                      className={`border-b border-slate-800/40 ${row.retired ? '' : 'text-slate-500'}`}
                    >
                      <td className="py-1.5 pr-4">{row.year}</td>
                      <td className="py-1.5 pr-4">{row.age}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{formatCurrency(row.portfolioValue)}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{formatCurrency(row.monthlyIncome)}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{formatCurrency(row.withdrawalAmount)}</td>
                      <td className="py-1.5 text-right font-mono">{formatCurrency(row.inflationAdjustedSpending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          isOpen
          title="Delete scenario?"
          message={`"${deleteTarget.name}" and its projection will be permanently deleted.`}
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}
