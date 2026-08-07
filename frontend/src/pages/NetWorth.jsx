import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
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
import { Card } from '../components/ui/card';
import { formatCurrency } from '../lib/accountTypes';

const CARD_SURFACE = '#0f172a';
// Validated on slate-900: CVD ΔE ≥ 8.4, contrast ≥ 3:1 for all pairs
const COLOR_LIQUID = '#6366f1';
const COLOR_RE = '#199e70';
const COLOR_OTHER = '#c98500';
const COLOR_LIABILITY = '#d55181';

function formatMonth(month) {
  const [y, m] = String(month).split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
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

function BreakdownRow({ color, label, value, pct, strong = false }) {
  return (
    <div className="flex items-center gap-2 py-1">
      {color ? <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} /> : <span className="w-2.5" />}
      <span className={strong ? 'font-medium text-slate-200' : 'text-slate-300'}>{label}</span>
      <span className={`ml-auto font-medium ${strong ? 'text-slate-100' : 'text-slate-200'}`}>{formatCurrency(value)}</span>
      <span className="w-12 text-right text-xs text-slate-500">{pct != null ? `${pct.toFixed(0)}%` : ''}</span>
    </div>
  );
}

function SubRow({ label, value }) {
  return (
    <div className="ml-5 flex items-center gap-1.5 py-0.5 text-xs">
      <span className="truncate flex-1 text-slate-500">{label}</span>
      <span className="shrink-0 font-mono text-slate-500">{formatCurrency(value)}</span>
    </div>
  );
}

export default function NetWorth() {
  const netWorthQuery = useQuery({
    queryKey: ['net-worth'],
    queryFn: async () => (await apiClient.get('/net-worth')).data,
  });

  const data = netWorthQuery.data;

  const monthChange = useMemo(() => {
    const history = data?.history || [];
    if (history.length < 2) return null;
    return history[history.length - 1].netWorth - history[history.length - 2].netWorth;
  }, [data]);

  const allocation = useMemo(() => {
    if (!data) return [];
    return [
      { name: 'Liquid investments', value: data.liquid.total, fill: COLOR_LIQUID },
      { name: 'Real estate', value: data.realEstate.totalValue, fill: COLOR_RE },
      { name: 'Other assets', value: data.other.total, fill: COLOR_OTHER },
      { name: 'Liabilities', value: data.liabilities.total, fill: COLOR_LIABILITY },
    ].filter((d) => d.value > 0);
  }, [data]);

  if (netWorthQuery.isLoading) {
    return <p className="py-12 text-center text-sm text-slate-400">Loading net worth…</p>;
  }
  if (netWorthQuery.isError || !data) {
    return <p className="py-12 text-center text-sm text-red-400">Failed to load net worth data.</p>;
  }

  const { liquid, realEstate, other, liabilities, totalAssets, netWorth, history } = data;
  const pctOfNet = (v) => (netWorth > 0 ? (v / netWorth) * 100 : null);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-slate-400">Total Net Worth</div>
        <div className="text-5xl font-semibold text-slate-100">{formatCurrency(netWorth)}</div>
        {monthChange != null ? (
          <p className={`mt-1 text-sm ${monthChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {monthChange >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(monthChange))} this month
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Assets</h3>
          <div className="text-sm">
            <BreakdownRow color={COLOR_LIQUID} label="Liquid Investments" value={liquid.total} pct={pctOfNet(liquid.total)} />
            {liquid.accounts.map((a) => (
              <SubRow key={a.id} label={a.display_name || a.name} value={a.balance} />
            ))}

            {realEstate.properties.length > 0 ? (
              <>
                <BreakdownRow color={COLOR_RE} label="Real Estate" value={realEstate.totalValue} pct={pctOfNet(realEstate.totalValue)} />
                {realEstate.properties.map((p) => (
                  <SubRow key={p.id} label={p.name} value={p.estimated_value} />
                ))}
              </>
            ) : null}

            {other.accounts.length > 0 ? (
              <>
                <BreakdownRow color={COLOR_OTHER} label="Other Assets" value={other.total} pct={pctOfNet(other.total)} />
                {other.accounts.map((a) => (
                  <SubRow
                    key={a.id}
                    label={`${a.display_name || a.name}${a.archived_at ? ' (archived)' : ' (excluded)'}`}
                    value={a.balance}
                  />
                ))}
              </>
            ) : null}

            <div className="mt-2 border-t border-slate-800 pt-2">
              <BreakdownRow label="Total Assets" value={totalAssets} strong />
            </div>
          </div>

          <h3 className="mb-1 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Liabilities</h3>
          <div className="text-sm">
            {liabilities.mortgages.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">No liabilities tracked.</p>
            ) : (
              liabilities.mortgages.map((m) => (
                <BreakdownRow key={m.id} color={COLOR_LIABILITY} label={`${m.name} mortgage`} value={m.balance} />
              ))
            )}
            <div className="mt-2 border-t border-slate-800 pt-2">
              <BreakdownRow label="Total Liabilities" value={liabilities.total} strong />
            </div>
          </div>

          <div className="mt-6 border-t-2 border-slate-700 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-slate-100">Net Worth</span>
              <span className="text-xl font-semibold text-slate-100">{formatCurrency(netWorth)}</span>
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Manage <Link to="/accounts" className="text-sky-400 hover:underline">accounts</Link> and{' '}
            <Link to="/real-estate" className="text-sky-400 hover:underline">properties</Link>.
          </p>
        </Card>

        <div className="space-y-6 xl:col-span-3">
          <Card>
            <h3 className="mb-4 text-lg font-semibold">Net Worth History</h3>
            {history.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                No history yet — take snapshots and record property values to build it.
              </p>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tickFormatter={formatMonth}
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
                    <Tooltip content={<ChartTooltip labelFormatter={formatMonth} />} cursor={{ stroke: '#475569', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="liquid" name="Liquid" stackId="nw"
                      stroke={COLOR_LIQUID} strokeWidth={2} fill={COLOR_LIQUID} fillOpacity={0.25} />
                    <Area type="monotone" dataKey="realEstateEquity" name="Real estate equity" stackId="nw"
                      stroke={COLOR_RE} strokeWidth={2} fill={COLOR_RE} fillOpacity={0.25} />
                    <Area type="monotone" dataKey="other" name="Other" stackId="nw"
                      stroke={COLOR_OTHER} strokeWidth={2} fill={COLOR_OTHER} fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            {history.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
                <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_LIQUID }} /> Liquid</li>
                <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_RE }} /> Real estate equity</li>
                <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_OTHER }} /> Other</li>
              </ul>
            ) : null}
          </Card>

          <Card>
            <h3 className="mb-4 text-lg font-semibold">Allocation</h3>
            {allocation.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">Nothing to allocate yet.</p>
            ) : (
              <div className="flex flex-col items-center gap-6 md:flex-row">
                <div className="h-64 w-full md:w-1/2">
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
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="w-full space-y-2.5 text-sm md:w-1/2">
                  {allocation.map((entry) => {
                    const totalGross = allocation.reduce((s, e) => s + e.value, 0);
                    return (
                      <li key={entry.name} className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: entry.fill }} />
                        <span className="text-slate-300">{entry.name}</span>
                        <span className="ml-auto font-medium text-slate-100">{formatCurrency(entry.value)}</span>
                        <span className="w-12 text-right text-slate-400">
                          {totalGross > 0 ? `${((entry.value / totalGross) * 100).toFixed(0)}%` : '—'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
