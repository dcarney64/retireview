import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
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
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ACCOUNT_TYPES, formatCurrency, typeColor, typeLabel } from '../lib/accountTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

const HISTORY_WINDOWS = [
  { id: '1m',  label: '1M',  days: 30  },
  { id: '3m',  label: '3M',  days: 90  },
  { id: '6m',  label: '6M',  days: 180 },
  { id: 'ytd', label: 'YTD', ytd: true },
  { id: '1y',  label: '1Y',  days: 365 },
  { id: 'all', label: 'All'             },
];

const DRAWDOWN_WINDOWS = [
  { id: 'ytd', label: 'YTD'            },
  { id: '1y',  label: '1Y'             },
  { id: '2y',  label: '2Y'             },
  { id: 'all', label: 'Since Inception' },
];

const BENCHMARKS = ['None', 'SPY', 'QQQ', 'BND', 'GLD'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SERIES_BLUE  = '#3987e5';
const CARD_SURFACE = '#0f172a'; // slate-900

// ─── Pure utility functions ───────────────────────────────────────────────────

function getWindowCutoff(windowId) {
  const w = HISTORY_WINDOWS.find((x) => x.id === windowId);
  if (!w) return null;
  const now = new Date();
  if (w.ytd)  return new Date(now.getFullYear(), 0, 1);
  if (w.days) { const d = new Date(now); d.setDate(d.getDate() - w.days); return d; }
  return null;
}

function getDrawdownCutoff(windowId) {
  const now = new Date();
  if (windowId === 'ytd') return new Date(now.getFullYear(), 0, 1);
  if (windowId === '1y')  { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
  if (windowId === '2y')  { const d = new Date(now); d.setFullYear(d.getFullYear() - 2); return d; }
  return null;
}

/** Slice any series [{date, ...}] to only points on or after cutoff. */
function filterSeriesByWindow(series, windowId) {
  if (!series?.length) return [];
  const cutoff = getWindowCutoff(windowId);
  if (!cutoff) return series;
  return series.filter((p) => new Date(p.date + 'T00:00:00') >= cutoff);
}

/** Rebase a [{date, value}] series so the first point = 100. */
function normalizeTo100(series) {
  if (!series.length) return [];
  const base = Number(series[0].value || 0);
  if (!base) return series.map((p) => ({ ...p, normalized: 100 }));
  return series.map((p) => ({ ...p, normalized: (Number(p.value) / base) * 100 }));
}

function toPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatAxisDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function heatmapClass(ret) {
  if (ret === null || ret === undefined || !Number.isFinite(ret)) {
    return 'bg-slate-700 text-slate-400';
  }
  const pct = ret * 100;
  if (pct >  5) return 'bg-green-600 text-white';
  if (pct >  2) return 'bg-green-400 text-slate-900';
  if (pct >  0) return 'bg-green-200 text-slate-900';
  if (pct === 0) return 'bg-slate-600 text-slate-200';
  if (pct > -2) return 'bg-red-200 text-slate-900';
  if (pct > -5) return 'bg-red-400 text-slate-900';
  return 'bg-red-600 text-white';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm shadow-lg">
      {label !== undefined ? (
        <div className="mb-1 text-xs text-slate-400">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      ) : null}
      {payload.map((entry) => (
        <div key={entry.dataKey || entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: entry.color || entry.stroke }}
          />
          <span className="text-slate-300">{entry.name}</span>
          <span className="ml-auto pl-4 font-mono font-medium text-slate-100">
            {valueFormatter ? valueFormatter(entry.value, entry.name) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatTile({ label, value, sub, valueClass = 'text-slate-100' }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-semibold ${valueClass}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function MonthlyHeatmap({ data, isLoading }) {
  const grid = useMemo(() => {
    const byYear = new Map();
    for (const row of data || []) {
      if (!byYear.has(row.year)) byYear.set(row.year, new Map());
      byYear.get(row.year).set(row.month, row);
    }
    const years = [...byYear.keys()].sort((a, b) => b - a);
    return years.map((year) => {
      const months = byYear.get(year);
      let product = 1;
      let count = 0;
      const cells = MONTH_LABELS.map((_, i) => {
        const cell = months.get(i + 1) || null;
        if (cell && Number.isFinite(cell.return_decimal)) {
          product *= 1 + Number(cell.return_decimal);
          count += 1;
        }
        return cell;
      });
      return { year, cells, yearTotal: count ? product - 1 : null };
    });
  }, [data]);

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-slate-800" />;
  if (!grid.length) {
    return (
      <p className="text-sm text-slate-500">
        No monthly data yet — snapshots in at least two different months are needed.
        Use <strong className="text-slate-400">Reconstruct History</strong> to populate this from transaction data.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="p-1 text-left text-slate-500">Year</th>
            {MONTH_LABELS.map((m) => (
              <th key={m} className="p-1 text-center text-slate-500">{m}</th>
            ))}
            <th className="p-1 text-center text-slate-500">YTD</th>
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row.year}>
              <td className="p-1 font-mono text-slate-400">{row.year}</td>
              {row.cells.map((cell, i) => (
                <td key={i} className="p-0.5">
                  <div
                    className={`flex h-10 min-w-[3rem] items-center justify-center rounded px-1 font-mono ${heatmapClass(cell?.return_decimal)}`}
                    title={cell
                      ? `${MONTH_LABELS[i]} ${row.year}: ${toPercent(cell.return_decimal)} (${formatCurrency(cell.value_start)} → ${formatCurrency(cell.value_end)})`
                      : 'No data'}
                  >
                    {cell ? `${(cell.return_decimal * 100).toFixed(1)}%` : '—'}
                  </div>
                </td>
              ))}
              <td className="p-0.5">
                <div className={`flex h-10 min-w-[3rem] items-center justify-center rounded font-mono ${heatmapClass(row.yearTotal)}`}>
                  {row.yearTotal !== null ? `${(row.yearTotal * 100).toFixed(1)}%` : '—'}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Performance() {
  const queryClient = useQueryClient();
  const [accountTypeFilter, setAccountTypeFilter] = useState('all');
  const [historyWindow, setHistoryWindow]         = useState('ytd');
  const [drawdownWindow, setDrawdownWindow]       = useState('all');
  const [benchmark, setBenchmark]                 = useState('None');
  const [reconstructMsg, setReconstructMsg]       = useState(null);

  // ── Data fetching ───────────────────────────────────────────────────────────
  const perfQuery = useQuery({
    queryKey: ['performance'],
    queryFn:  async () => (await apiClient.get('/performance')).data,
    staleTime: 5 * 60_000,
  });

  const reconstructMutation = useMutation({
    mutationFn: async () => (await apiClient.post('/performance/reconstruct-history')).data,
    onSuccess: (result) => {
      if (result.monthsReconstructed > 0) {
        setReconstructMsg({
          ok: true,
          text: `Reconstructed ${result.monthsReconstructed} month${result.monthsReconstructed === 1 ? '' : 's'} of history`
            + (result.earliestDate ? ` from ${new Date(result.earliestDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : '') + '.',
        });
      } else {
        setReconstructMsg({
          ok: false,
          text: 'No new history found. Either transaction data is unavailable or all months are already covered.',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['performance'] });
    },
    onError: (err) => setReconstructMsg({
      ok: false,
      text: err?.response?.data?.error || 'Reconstruction failed.',
    }),
  });

  const benchmarkQuery = useQuery({
    queryKey: ['performance-benchmark', benchmark],
    enabled:  benchmark !== 'None',
    queryFn:  async () => (await apiClient.get(`/performance/benchmark/${benchmark}`)).data,
    staleTime: 24 * 60 * 60_000,
  });

  const data = perfQuery.data;

  // ── Derived: main series (type-filtered, then window-filtered) ─────────────
  const filteredSeries = useMemo(() => {
    if (!data?.series) return [];
    if (accountTypeFilter === 'all') return data.series;
    // Extract the selected type's balance at each snapshot from accountTypeSeries.
    return (data.accountTypeSeries || []).map((p) => ({
      date:  p.date,
      total: p[accountTypeFilter] || 0,
    }));
  }, [data, accountTypeFilter]);

  const windowedSeries = useMemo(
    () => filterSeriesByWindow(filteredSeries, historyWindow),
    [filteredSeries, historyWindow]
  );

  // ── Derived: chart data (absolute vs benchmark-normalized) ─────────────────
  const benchTicker = benchmark !== 'None' ? benchmark : null;

  const chartData = useMemo(() => {
    if (!benchTicker || !benchmarkQuery.data?.series?.length || !windowedSeries.length) {
      return { mode: 'absolute', points: windowedSeries };
    }
    const benchByDate = new Map(benchmarkQuery.data.series.map((p) => [p.date, p.close]));
    const benchSlice = windowedSeries
      .map((p) => ({ date: p.date, value: benchByDate.get(p.date) }))
      .filter((p) => p.value != null);

    if (!benchSlice.length) return { mode: 'absolute', points: windowedSeries };

    const normBench  = normalizeTo100(benchSlice);
    const normPortfolio = normalizeTo100(windowedSeries.map((p) => ({ date: p.date, value: p.total })));
    const benchMap   = new Map(normBench.map((p) => [p.date, p.normalized]));

    return {
      mode: 'normalized',
      points: normPortfolio.map((p) => ({
        date:      p.date,
        portfolio: p.normalized,
        benchmark: benchMap.get(p.date) ?? null,
      })),
    };
  }, [benchTicker, benchmarkQuery.data, windowedSeries]);

  // ── Derived: transfers in window (for reference lines) ─────────────────────
  const transfersInWindow = useMemo(() => {
    if (!data?.transfers || !windowedSeries.length) return [];
    const first = windowedSeries[0].date;
    const last  = windowedSeries[windowedSeries.length - 1].date;
    return data.transfers.filter((t) => t.date >= first && t.date <= last);
  }, [data?.transfers, windowedSeries]);

  // ── Derived: drawdown series (window-filtered) ──────────────────────────────
  const drawdownPoints = useMemo(() => {
    const series = data?.drawdown?.series || [];
    const cutoff = getDrawdownCutoff(drawdownWindow);
    const filtered = cutoff
      ? series.filter((p) => new Date(p.date + 'T00:00:00') >= cutoff)
      : series;
    return filtered.map((p) => ({ date: p.date, drawdownPct: p.drawdown_decimal * 100 }));
  }, [data?.drawdown?.series, drawdownWindow]);

  // ── Derived: stacked area data (window-filtered) ────────────────────────────
  const stackedData = useMemo(
    () => filterSeriesByWindow(data?.accountTypeSeries || [], historyWindow),
    [data?.accountTypeSeries, historyWindow]
  );

  // ── Stats for selected window (always total-portfolio) ─────────────────────
  const wStats = data?.windowStats?.[historyWindow] || {};
  const twrColor      = wStats.twr   >= 0 ? 'text-emerald-400' : 'text-red-400';
  const retColor      = wStats.simpleReturn >= 0 ? 'text-emerald-400' : 'text-red-400';
  const drawdownColor = 'text-red-400';

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function monthLabel(m) { return m ? `${MONTH_NAMES[m.month - 1]} ${m.year}` : '—'; }

  const types = data?.types || [];

  // ─────────────────────────────────────────────────────────────────────────────
  if (perfQuery.isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Performance</h2>
        <div className="h-32 animate-pulse rounded-lg bg-slate-800" />
        <div className="h-72 animate-pulse rounded-lg bg-slate-800" />
      </div>
    );
  }

  if (perfQuery.isError) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Performance</h2>
        <Card>
          <p className="text-sm text-red-400">
            {perfQuery.error?.response?.data?.error || 'Failed to load performance data.'}
          </p>
        </Card>
      </div>
    );
  }

  const hasData = (data?.series?.length || 0) >= 2;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Performance</h2>
          <p className="mt-1 text-sm text-slate-400">
            Based on {data?.series?.length || 0} snapshot{data?.series?.length === 1 ? '' : 's'}.{' '}
            {(data?.transfers?.length || 0) > 0
              ? `${data.transfers.length} transfer${data.transfers.length === 1 ? '' : 's'} logged for TWR adjustment.`
              : 'Log transfers on the Accounts page for accurate TWR.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
            onClick={() => { setReconstructMsg(null); reconstructMutation.mutate(); }}
            disabled={reconstructMutation.isPending}
            title="Build historical monthly snapshots from your transaction history"
          >
            {reconstructMutation.isPending ? 'Reconstructing…' : 'Reconstruct History'}
          </Button>
          {reconstructMsg ? (
            <p className={`text-xs ${reconstructMsg.ok ? 'text-emerald-400' : 'text-slate-400'}`}>
              {reconstructMsg.text}
            </p>
          ) : null}
        </div>
      </div>

      {!hasData ? (
        <Card>
          <div className="py-6 text-center space-y-3">
            <p className="text-sm text-slate-400">
              Syncing your account history…
            </p>
            <p className="text-sm text-slate-500">
              If this is your first sync, click <strong className="text-slate-300">Reconstruct History</strong> to
              import historical data from your connected brokerages — or connect a brokerage on the{' '}
              <Link to="/connections" className="text-sky-400 hover:underline">Connections page</Link>.
            </p>
            <Button
              className="bg-slate-700 hover:bg-slate-600 text-sm mx-auto"
              onClick={() => { setReconstructMsg(null); reconstructMutation.mutate(); }}
              disabled={reconstructMutation.isPending}
            >
              {reconstructMutation.isPending ? 'Reconstructing…' : 'Reconstruct History'}
            </Button>
            {reconstructMsg ? (
              <p className={`text-xs ${reconstructMsg.ok ? 'text-emerald-400' : 'text-slate-400'}`}>
                {reconstructMsg.text}
              </p>
            ) : null}
          </div>
        </Card>
      ) : (
        <>
          {/* Account type filter */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAccountTypeFilter('all')}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                accountTypeFilter === 'all'
                  ? 'bg-sky-500 text-white'
                  : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              All Accounts
            </button>
            {ACCOUNT_TYPES.filter((t) => types.includes(t.value)).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setAccountTypeFilter(t.value)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                  accountTypeFilter === t.value
                    ? 'text-white'
                    : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
                style={accountTypeFilter === t.value ? { background: t.color } : {}}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: t.color }}
                />
                {t.label}
              </button>
            ))}
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <StatTile
              label="TWR (transfer-adjusted)"
              value={toPercent(wStats.twr)}
              sub={`${wStats.snapshotCount || 0} snapshots`}
              valueClass={wStats.twr != null ? twrColor : 'text-slate-500'}
            />
            <StatTile
              label="Simple return"
              value={toPercent(wStats.simpleReturn)}
              sub="unadjusted"
              valueClass={wStats.simpleReturn != null ? retColor : 'text-slate-500'}
            />
            <StatTile
              label="Max drawdown (all time)"
              value={data.drawdown?.maxDrawdown != null ? toPercent(data.drawdown.maxDrawdown) : '—'}
              sub={data.drawdown?.troughDate ? `trough ${formatDate(data.drawdown.troughDate)}` : null}
              valueClass={drawdownColor}
            />
            <StatTile
              label="Best month"
              value={data.bestMonth ? `${(data.bestMonth.return_decimal * 100).toFixed(1)}%` : '—'}
              sub={monthLabel(data.bestMonth)}
              valueClass="text-emerald-400"
            />
            <StatTile
              label="Worst month"
              value={data.worstMonth ? `${(data.worstMonth.return_decimal * 100).toFixed(1)}%` : '—'}
              sub={monthLabel(data.worstMonth)}
              valueClass="text-red-400"
            />
          </div>

          {/* Portfolio value chart */}
          <Card>
            {/* Window + benchmark controls */}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">
                  {accountTypeFilter === 'all' ? 'Total net worth' : typeLabel(accountTypeFilter)}
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold text-slate-100">
                  {windowedSeries.length
                    ? formatCurrency(windowedSeries[windowedSeries.length - 1].total)
                    : '—'}
                </p>
                {windowedSeries.length >= 2 ? (
                  <p className={`text-sm font-mono ${wStats.simpleReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {toPercent(wStats.simpleReturn)} simple · {toPercent(wStats.twr)} TWR
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {HISTORY_WINDOWS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setHistoryWindow(w.id)}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      historyWindow === w.id
                        ? 'bg-sky-500 text-white'
                        : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Benchmark toggle */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Benchmark:</span>
              {BENCHMARKS.map((ticker) => (
                <button
                  key={ticker}
                  type="button"
                  onClick={() => setBenchmark(ticker)}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    benchmark === ticker
                      ? 'bg-orange-500/20 text-orange-300'
                      : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {ticker}
                </button>
              ))}
              {benchTicker && benchmarkQuery.isLoading ? (
                <span className="text-xs text-slate-500">Loading {benchmark}…</span>
              ) : null}
              {benchTicker && benchmarkQuery.isError ? (
                <span className="text-xs text-red-400">Could not fetch {benchmark}</span>
              ) : null}
            </div>

            {/* Chart */}
            {windowedSeries.length < 2 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                Not enough snapshots in this window.
              </p>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {chartData.mode === 'normalized' ? (
                    <LineChart data={chartData.points}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatAxisDate}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={{ stroke: '#334155' }}
                        tickLine={false}
                        minTickGap={32}
                      />
                      <YAxis
                        tickFormatter={(v) => v.toFixed(0)}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            labelFormatter={formatAxisDate}
                            valueFormatter={(v, name) =>
                              `${Number(v).toFixed(1)} (${name === 'portfolio' ? 'Portfolio' : benchmark})`
                            }
                          />
                        }
                        cursor={{ stroke: '#475569', strokeWidth: 1 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="portfolio"
                        name="Portfolio"
                        stroke={SERIES_BLUE}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, stroke: CARD_SURFACE, strokeWidth: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="benchmark"
                        name={benchmark}
                        stroke="#f97316"
                        strokeWidth={2}
                        strokeDasharray="6 3"
                        dot={false}
                        connectNulls
                        activeDot={{ r: 4, stroke: CARD_SURFACE, strokeWidth: 2 }}
                      />
                    </LineChart>
                  ) : (
                    <AreaChart data={chartData.points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={SERIES_BLUE} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={SERIES_BLUE} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="0" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatAxisDate}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={{ stroke: '#334155' }}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tickFormatter={(v) => formatCurrency(v, { compact: true })}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={72}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            labelFormatter={formatAxisDate}
                            valueFormatter={(v) => formatCurrency(v)}
                          />
                        }
                        cursor={{ stroke: '#475569', strokeWidth: 1 }}
                      />
                      {/* Transfer reference lines */}
                      {transfersInWindow.map((t, i) => (
                        <ReferenceLine
                          key={`${t.date}-${i}`}
                          x={t.date}
                          stroke={t.amount >= 0 ? '#22c55e' : '#f59e0b'}
                          strokeDasharray="4 4"
                          label={{
                            value: `${t.amount >= 0 ? '+' : ''}${formatCurrency(t.amount)}`,
                            fill:  t.amount >= 0 ? '#22c55e' : '#f59e0b',
                            fontSize: 10,
                            position: 'insideTopRight',
                          }}
                        />
                      ))}
                      <Area
                        type="monotone"
                        dataKey="total"
                        name={accountTypeFilter === 'all' ? 'Net worth' : typeLabel(accountTypeFilter)}
                        stroke={accountTypeFilter === 'all' ? SERIES_BLUE : typeColor(accountTypeFilter)}
                        strokeWidth={2}
                        fill="url(#perfFill)"
                        dot={false}
                        activeDot={{ r: 4, stroke: CARD_SURFACE, strokeWidth: 2 }}
                      />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Stacked area by account type */}
          {types.length > 1 ? (
            <Card>
              <h3 className="mb-4 text-lg font-semibold">Allocation Over Time</h3>
              {stackedData.length < 2 ? (
                <p className="text-sm text-slate-500">Not enough snapshots in this window.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stackedData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatAxisDate}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={{ stroke: '#334155' }}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tickFormatter={(v) => formatCurrency(v, { compact: true })}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={72}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            labelFormatter={formatAxisDate}
                            valueFormatter={(v) => formatCurrency(v)}
                          />
                        }
                        cursor={{ stroke: '#475569', strokeWidth: 1 }}
                      />
                      {types.map((type) => {
                        const color = typeColor(type);
                        return (
                          <Area
                            key={type}
                            type="monotone"
                            dataKey={type}
                            name={typeLabel(type)}
                            stackId="1"
                            stroke={color}
                            fill={color}
                            fillOpacity={0.7}
                            dot={false}
                          />
                        );
                      })}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* Legend */}
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {types.map((type) => (
                  <li key={type} className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: typeColor(type) }} />
                    <span className="text-slate-400">{typeLabel(type)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* Monthly return heatmap */}
          <Card>
            <h3 className="mb-4 text-lg font-semibold">Monthly Return Heatmap</h3>
            <p className="mb-3 text-xs text-slate-500">
              Returns are TWR-adjusted for any logged transfers in each period.
            </p>
            <MonthlyHeatmap data={data?.monthlyReturns} isLoading={perfQuery.isLoading} />
          </Card>

          {/* Drawdown chart */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Drawdown</h3>
              <div className="flex gap-1.5">
                {DRAWDOWN_WINDOWS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setDrawdownWindow(w.id)}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      drawdownWindow === w.id
                        ? 'bg-sky-500 text-white'
                        : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Drawdown metadata */}
            <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Max Drawdown</p>
                <p className="font-mono text-red-400">
                  {data.drawdown?.maxDrawdown != null ? toPercent(data.drawdown.maxDrawdown) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Peak</p>
                <p className="font-mono text-slate-200">{formatDate(data.drawdown?.peakDate)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Trough</p>
                <p className="font-mono text-slate-200">{formatDate(data.drawdown?.troughDate)}</p>
              </div>
            </div>

            {drawdownPoints.length < 2 ? (
              <p className="text-sm text-slate-500">Not enough data for this window.</p>
            ) : (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={drawdownPoints} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatAxisDate}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={{ stroke: '#334155' }}
                      tickLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      tickFormatter={(v) => `${v.toFixed(0)}%`}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      domain={['auto', 0]}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          labelFormatter={formatAxisDate}
                          valueFormatter={(v) => `${Number(v).toFixed(2)}%`}
                        />
                      }
                      cursor={{ stroke: '#475569', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="drawdownPct"
                      name="Drawdown"
                      stroke="#ef4444"
                      fill="#ef4444"
                      fillOpacity={0.3}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
