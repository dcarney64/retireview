import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import apiClient from '../api/client';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ACCOUNT_TYPES, formatCurrency, typeColor, typeLabel } from '../lib/accountTypes';

const CARD_SURFACE = '#0f172a'; // slate-900 — segment gaps ring in the surface color
const SERIES_BLUE = '#3987e5';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function ChartTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm shadow-lg">
      {label !== undefined ? (
        <div className="mb-1 text-xs text-slate-400">{labelFormatter ? labelFormatter(label) : label}</div>
      ) : null}
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: entry.payload?.fill || entry.color || entry.stroke }} />
          <span className="text-slate-300">{entry.name}</span>
          <span className="ml-auto pl-3 font-medium text-slate-100">{formatCurrency(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function GoalProgress({ goal, total }) {
  if (!goal) {
    return (
      <p className="text-sm text-slate-400">
        No goal set yet — <Link to="/goal" className="text-sky-400 hover:underline">use the calculator</Link> to set one.
      </p>
    );
  }

  const target = Number(goal.target_amount);
  const pct = target > 0 ? Math.min(100, (total / target) * 100) : 0;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-400">
          Goal: <span className="text-slate-200">{formatCurrency(target)}</span>
          {goal.target_date ? <span> by {formatDate(goal.target_date)}</span> : null}
        </span>
        <span className="font-medium text-slate-100">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [snapshotError, setSnapshotError] = useState('');

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await apiClient.get('/accounts')).data,
  });
  const snapshotsQuery = useQuery({
    queryKey: ['snapshots'],
    queryFn: async () => (await apiClient.get('/snapshots')).data,
  });
  const goalQuery = useQuery({
    queryKey: ['goal'],
    queryFn: async () => (await apiClient.get('/goals')).data,
  });

  const snapshotMutation = useMutation({
    mutationFn: async () => apiClient.post('/snapshots', {}),
    onSuccess: () => {
      setSnapshotError('');
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    },
    onError: (err) => setSnapshotError(err?.response?.data?.error || 'Failed to take snapshot'),
  });

  const deleteSnapshotMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/snapshots/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snapshots'] }),
  });

  const accounts  = accountsQuery.data || [];
  const snapshots = snapshotsQuery.data || [];
  const goal      = goalQuery.data;

  // Only sum accounts that are included in tracking
  const trackedAccounts  = useMemo(() => accounts.filter((a) => a.include_in_tracking !== false), [accounts]);
  const excludedCount    = accounts.length - trackedAccounts.length;

  const total = useMemo(
    () => trackedAccounts.reduce((sum, a) => sum + Number(a.balance), 0),
    [trackedAccounts]
  );

  const history = useMemo(
    () => [...snapshots]
      .sort((a, b) => (a.snapped_at < b.snapped_at ? -1 : 1))
      .map((s) => ({ date: s.snapped_at, total: Number(s.total) })),
    [snapshots]
  );

  const allocation = useMemo(() => {
    const sums = {};
    for (const account of trackedAccounts) {
      sums[account.type] = (sums[account.type] || 0) + Number(account.balance);
    }
    // Fixed type order so colors stay stable as accounts come and go
    return ACCOUNT_TYPES
      .filter((t) => sums[t.value] > 0)
      .map((t) => ({ name: t.label, type: t.value, value: sums[t.value], fill: t.color }));
  }, [accounts]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-slate-400">Net worth</div>
          <div className="text-4xl font-semibold text-slate-100">{formatCurrency(total)}</div>
          {excludedCount > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              {excludedCount} account{excludedCount === 1 ? '' : 's'} excluded from total ·{' '}
              <a href="/accounts" className="underline hover:text-slate-300">manage</a>
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <Button onClick={() => snapshotMutation.mutate()} disabled={snapshotMutation.isPending}>
            {snapshotMutation.isPending ? 'Saving...' : 'Take Snapshot'}
          </Button>
          {snapshotError ? <p className="mt-1 text-sm text-red-400">{snapshotError}</p> : null}
        </div>
      </div>

      <Card>
        <h3 className="mb-3 text-lg font-semibold">Goal Progress</h3>
        <GoalProgress goal={goal} total={total} />
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <h3 className="mb-4 text-lg font-semibold">Net Worth Over Time</h3>
          {history.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">
              No snapshots yet — take one to start building history.
            </p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES_BLUE} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={SERIES_BLUE} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => formatDate(d)}
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
                  />
                  <Tooltip
                    content={<ChartTooltip labelFormatter={formatDate} />}
                    cursor={{ stroke: '#475569', strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Net worth"
                    stroke={SERIES_BLUE}
                    strokeWidth={2}
                    fill="url(#netWorthFill)"
                    dot={false}
                    activeDot={{ r: 4, stroke: CARD_SURFACE, strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <h3 className="mb-4 text-lg font-semibold">Allocation</h3>
          {allocation.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">
              No accounts yet — <Link to="/accounts" className="text-sky-400 hover:underline">add your accounts</Link> to see allocation.
            </p>
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip content={<ChartTooltip />} />
                    <Pie
                      data={allocation}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="62%"
                      outerRadius="90%"
                      paddingAngle={1.5}
                      stroke={CARD_SURFACE}
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {allocation.map((entry) => (
                        <Cell key={entry.type} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {allocation.map((entry) => (
                  <li key={entry.type} className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.fill }} />
                    <span className="text-slate-300">{entry.name}</span>
                    <span className="ml-auto font-medium text-slate-100">{formatCurrency(entry.value)}</span>
                    <span className="w-12 text-right text-slate-400">
                      {total > 0 ? `${((entry.value / total) * 100).toFixed(0)}%` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-4 text-lg font-semibold">Recent Snapshots</h3>
        {snapshots.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {snapshots.slice(0, 5).map((snapshot) => (
              <div key={snapshot.id} className="flex items-center gap-3 rounded-md border border-slate-800 px-3 py-2">
                <span className="text-slate-300">{formatDate(snapshot.snapped_at)}</span>
                {snapshot.note ? <span className="truncate text-slate-500">{snapshot.note}</span> : null}
                <span className="ml-auto font-medium text-slate-100">{formatCurrency(snapshot.total)}</span>
                <button
                  type="button"
                  className="text-slate-500 hover:text-red-400"
                  title="Delete snapshot"
                  onClick={() => deleteSnapshotMutation.mutate(snapshot.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
