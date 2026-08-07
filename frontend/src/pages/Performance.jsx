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

// Palette for per-account lines — distinct, CVD-safe, readable on slate-900.
const ACCOUNT_PALETTE = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // green
  '#c98500', // amber
  '#d55181', // pink
  '#9085e9', // violet
  '#e85d04', // deep orange
  '#008300', // dark green
  '#7b2d8b', // purple
  '#1a7a4a', // forest green
];

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

// Compact axis tick label: "Jan '25", "Jul '26" etc.
function formatAxisTick(dateStr) {
  if (!dateStr) return '';
  const d   = new Date(dateStr + 'T00:00:00');
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  const yr  = String(d.getFullYear()).slice(2);
  return `${mon} '${yr}`;
}

// Find year-transition points in a series [{date, ...}].
// Returns [{date, year}] for the first data point in each new year (skip first).
function getYearMarkers(series) {
  if (!series?.length) return [];
  const markers = [];
  let prevYear  = series[0].date.slice(0, 4);
  for (const p of series) {
    const year = p.date.slice(0, 4);
    if (year !== prevYear) {
      markers.push({ date: p.date, year });
      prevYear = year;
    }
  }
  return markers;
}

// Generate explicit x-axis tick dates at a density appropriate for the
// data length: monthly (<6 mo), quarterly (6-18 mo), semi-annual (>18 mo).
// Returns an array of date strings from the series, or undefined to let
// Recharts auto-tick.
function getXAxisTicks(series) {
  if (!series?.length) return undefined;
  const dates     = series.map((p) => p.date);
  const first     = new Date(dates[0] + 'T00:00:00');
  const last      = new Date(dates[dates.length - 1] + 'T00:00:00');
  const totalDays = (last - first) / 86_400_000;

  let monthStep;
  if      (totalDays < 180) monthStep = 1;   // monthly
  else if (totalDays < 540) monthStep = 3;   // quarterly
  else                       monthStep = 6;   // semi-annual

  const dateSet = new Set(dates);
  const ticks   = [];

  // Start at the first full month boundary on or after the first data point.
  let cur = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cur < first) cur = new Date(cur.getFullYear(), cur.getMonth() + monthStep, 1);

  while (cur <= last) {
    const iso = cur.toISOString().slice(0, 10);
    if (dateSet.has(iso)) {
      ticks.push(iso);
    } else {
      // Snap forward up to 7 days to find the nearest available data point.
      for (let d = 1; d <= 7; d++) {
        const adj    = new Date(cur);
        adj.setDate(adj.getDate() + d);
        const adjIso = adj.toISOString().slice(0, 10);
        if (dateSet.has(adjIso)) { ticks.push(adjIso); break; }
      }
    }
    cur = new Date(cur.getFullYear(), cur.getMonth() + monthStep, 1);
  }

  return ticks.length ? ticks : undefined;
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

// Short display name for an account (strip the " · ACCT#" suffix when present).
function shortAccountName(name) {
  const idx = name.lastIndexOf(' · ');
  return idx >= 0 ? name.slice(0, idx) : name;
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

function StatTile({ label, value, sub, valueClass = 'text-slate-100', tooltip }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-slate-500">{label}</p>
        {tooltip ? (
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full bg-slate-700 text-[9px] font-bold text-slate-400"
            title={tooltip}
          >?</span>
        ) : null}
      </div>
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

  // View mode: 'all' | 'type' | 'account'
  const [viewMode,         setViewMode]         = useState('all');
  const [accountTypeFilter, setAccountTypeFilter] = useState('all');
  // null → all accounts selected; Set<accountId> → specific accounts
  const [selectedAccountIds, setSelectedAccountIds] = useState(null);

  const [historyWindow,   setHistoryWindow]   = useState('ytd');
  const [drawdownWindow,  setDrawdownWindow]  = useState('all');
  const [benchmark,       setBenchmark]       = useState('None');
  const [reconstructMsg,  setReconstructMsg]  = useState(null);
  // Inline rename state (By Account legend)
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editingName,      setEditingName]      = useState('');

  // ── Data fetching ───────────────────────────────────────────────────────────
  const perfQuery = useQuery({
    queryKey: ['performance'],
    queryFn:  async () => (await apiClient.get('/performance')).data,
    staleTime: 5 * 60_000,
  });

  // Quick rename: sets display_name via PUT and refreshes both performance
  // and accounts queries so names update everywhere simultaneously.
  const renameMutation = useMutation({
    mutationFn: ({ accountId, displayName }) =>
      apiClient.put(`/accounts/${accountId}`, { display_name: displayName?.trim() || null }),
    onSuccess: () => {
      setEditingAccountId(null);
      setEditingName('');
      queryClient.invalidateQueries({ queryKey: ['performance'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
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

  // ── Derived: accountSeries + palette ───────────────────────────────────────
  const accountSeries = data?.accountSeries || [];

  // Toggle a single account in the "By Account" selector.
  function toggleAccount(accountId) {
    const allIds = new Set(accountSeries.map((a) => a.accountId));
    const current = selectedAccountIds ?? allIds;
    const next = new Set(current);
    if (next.has(accountId)) next.delete(accountId);
    else                     next.add(accountId);
    // If all are selected again, go back to null (simpler state).
    setSelectedAccountIds(next.size === allIds.size ? null : next);
  }

  function isAccountSelected(accountId) {
    return !selectedAccountIds || selectedAccountIds.has(accountId);
  }

  // ── Derived: "By Account" chart data ───────────────────────────────────────
  // Merges per-account series into a single date-keyed array for Recharts.
  const accountChartData = useMemo(() => {
    if (!accountSeries.length) return [];

    const activeAccounts = accountSeries.filter((a) => isAccountSelected(a.accountId));
    if (!activeAccounts.length) return [];

    const cutoff = getWindowCutoff(historyWindow);

    // Build Map<date, value> per account and collect all dates.
    const allDateSet = new Set();
    const accountMaps = activeAccounts.map((acct) => {
      const filtered = cutoff
        ? acct.data.filter((p) => new Date(p.date + 'T00:00:00') >= cutoff)
        : acct.data;
      const map = new Map(filtered.map((p) => [p.date, p.value]));
      for (const date of map.keys()) allDateSet.add(date);
      return { acct, map };
    });

    const sortedDates = [...allDateSet].sort();
    return sortedDates.map((date) => {
      const point = { date };
      for (const { acct, map } of accountMaps) {
        point[acct.accountId] = map.get(date) ?? null;
      }
      return point;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountSeries, selectedAccountIds, historyWindow]);

  // Stats for a single selected account (used in stat tiles).
  const singleSelectedAccount = useMemo(() => {
    if (viewMode !== 'account' || !selectedAccountIds || selectedAccountIds.size !== 1) return null;
    const [id] = selectedAccountIds;
    return accountSeries.find((a) => a.accountId === id) || null;
  }, [viewMode, selectedAccountIds, accountSeries]);

  const singleAccountWindowed = useMemo(() => {
    if (!singleSelectedAccount) return null;
    const cutoff = getWindowCutoff(historyWindow);
    const pts = singleSelectedAccount.data;
    return cutoff
      ? pts.filter((p) => new Date(p.date + 'T00:00:00') >= cutoff)
      : pts;
  }, [singleSelectedAccount, historyWindow]);

  // ── Derived: main series (type-filtered, then window-filtered) ─────────────
  const filteredSeries = useMemo(() => {
    if (!data?.series) return [];
    if (viewMode === 'all' || viewMode === 'account' || accountTypeFilter === 'all') return data.series;
    return (data.accountTypeSeries || []).map((p) => ({
      date:  p.date,
      total: p[accountTypeFilter] || 0,
    }));
  }, [data, viewMode, accountTypeFilter]);

  const windowedSeries = useMemo(
    () => filterSeriesByWindow(filteredSeries, historyWindow),
    [filteredSeries, historyWindow]
  );

  // ── Derived: chart data (absolute vs benchmark-normalized) ─────────────────
  const benchTicker = benchmark !== 'None' ? benchmark : null;

  const chartData = useMemo(() => {
    if (viewMode === 'account') return { mode: 'account', points: [] };
    if (!benchTicker || !benchmarkQuery.data?.series?.length || !windowedSeries.length) {
      return { mode: 'absolute', points: windowedSeries };
    }
    const benchByDate = new Map(benchmarkQuery.data.series.map((p) => [p.date, p.close]));
    const benchSlice = windowedSeries
      .map((p) => ({ date: p.date, value: benchByDate.get(p.date) }))
      .filter((p) => p.value != null);

    if (!benchSlice.length) return { mode: 'absolute', points: windowedSeries };

    const normBench     = normalizeTo100(benchSlice);
    const normPortfolio = normalizeTo100(windowedSeries.map((p) => ({ date: p.date, value: p.total })));
    const benchMap      = new Map(normBench.map((p) => [p.date, p.normalized]));

    return {
      mode: 'normalized',
      points: normPortfolio.map((p) => ({
        date:      p.date,
        portfolio: p.normalized,
        benchmark: benchMap.get(p.date) ?? null,
      })),
    };
  }, [viewMode, benchTicker, benchmarkQuery.data, windowedSeries]);

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

  // ── Year markers and smart tick arrays for each chart ───────────────────────
  const yearMarkers       = useMemo(() => getYearMarkers(windowedSeries),  [windowedSeries]);
  const xAxisTicks        = useMemo(() => getXAxisTicks(windowedSeries),   [windowedSeries]);
  const drawdownMarkers   = useMemo(() => getYearMarkers(drawdownPoints),  [drawdownPoints]);
  const drawdownTicks     = useMemo(() => getXAxisTicks(drawdownPoints),   [drawdownPoints]);
  const stackedMarkers    = useMemo(() => getYearMarkers(stackedData),     [stackedData]);
  const stackedTicks      = useMemo(() => getXAxisTicks(stackedData),      [stackedData]);
  const accountYearMarkers = useMemo(() => getYearMarkers(accountChartData), [accountChartData]);
  const accountXAxisTicks  = useMemo(() => getXAxisTicks(accountChartData),  [accountChartData]);

  // ── Stats for selected window ─────────────────────────────────────────────
  const wStats      = data?.windowStats?.[historyWindow] || {};
  const twrColor    = wStats.twr         >= 0 ? 'text-emerald-400' : 'text-red-400';
  const retColor    = wStats.simpleReturn >= 0 ? 'text-emerald-400' : 'text-red-400';
  const drawdownColor = 'text-red-400';

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function monthLabel(m) { return m ? `${MONTH_NAMES[m.month - 1]} ${m.year}` : '—'; }

  const types = data?.types || [];

  // ── Stat tiles for single-account "By Account" mode ─────────────────────────
  const singleAcctCurrentValue = singleAccountWindowed?.length
    ? singleAccountWindowed[singleAccountWindowed.length - 1].value
    : null;
  const singleAcctStartValue = singleAccountWindowed?.length
    ? singleAccountWindowed[0].value
    : null;
  const singleAcctSimpleReturn =
    singleAcctStartValue > 0 && singleAcctCurrentValue != null
      ? (singleAcctCurrentValue - singleAcctStartValue) / singleAcctStartValue
      : null;

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
          {/* ── View mode selector ─────────────────────────────────────────── */}
          <div className="space-y-2">
            {/* Level 1: All Accounts | By Type | By Account */}
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all',     label: 'All Accounts' },
                { id: 'type',    label: 'By Type',     hide: types.length < 2 },
                { id: 'account', label: 'By Account',  hide: accountSeries.length === 0 },
              ].filter((m) => !m.hide).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setViewMode(mode.id);
                    if (mode.id !== 'type') setAccountTypeFilter('all');
                    if (mode.id !== 'account') setSelectedAccountIds(null);
                  }}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    viewMode === mode.id
                      ? 'bg-sky-500 text-white'
                      : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {/* Level 2a: Type pills (By Type mode) */}
            {viewMode === 'type' && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAccountTypeFilter('all')}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    accountTypeFilter === 'all'
                      ? 'bg-sky-500 text-white'
                      : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  All Types
                </button>
                {ACCOUNT_TYPES.filter((t) => types.includes(t.value)).map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setAccountTypeFilter(t.value)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                      accountTypeFilter === t.value
                        ? 'text-white'
                        : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                    style={accountTypeFilter === t.value ? { background: t.color } : {}}
                  >
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {/* Level 2b: Account pills (By Account mode) */}
            {viewMode === 'account' && accountSeries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedAccountIds(null)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    !selectedAccountIds
                      ? 'bg-sky-500 text-white'
                      : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  All
                </button>
                {accountSeries.map((acct, i) => {
                  const color    = ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length];
                  const selected = isAccountSelected(acct.accountId);
                  return (
                    <button
                      key={acct.accountId}
                      type="button"
                      onClick={() => toggleAccount(acct.accountId)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                        selected
                          ? 'text-white'
                          : 'border border-slate-700 text-slate-400 hover:bg-slate-800 opacity-50'
                      }`}
                      style={selected ? { background: color } : {}}
                      title={acct.accountName}
                    >
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                      <span className="max-w-[160px] truncate">{shortAccountName(acct.accountName)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Stat tiles ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {singleSelectedAccount ? (
              // Single account selected in By Account mode: show account-specific stats.
              <>
                <StatTile
                  label="Current value"
                  value={singleAcctCurrentValue != null ? formatCurrency(singleAcctCurrentValue) : '—'}
                  sub={singleSelectedAccount.accountName}
                  valueClass="text-slate-100"
                />
                <StatTile
                  label="Simple return (window)"
                  value={toPercent(singleAcctSimpleReturn)}
                  sub={HISTORY_WINDOWS.find((w) => w.id === historyWindow)?.label}
                  valueClass={singleAcctSimpleReturn != null
                    ? singleAcctSimpleReturn >= 0 ? 'text-emerald-400' : 'text-red-400'
                    : 'text-slate-500'}
                />
                <StatTile
                  label="Data points"
                  value={singleSelectedAccount.data.length}
                  sub="daily NAV values"
                  valueClass="text-slate-100"
                />
                <StatTile
                  label="Start date"
                  value={singleSelectedAccount.data[0]?.date
                    ? formatDate(singleSelectedAccount.data[0].date)
                    : '—'}
                  sub="earliest history"
                  valueClass="text-slate-100"
                />
                <StatTile
                  label="Account type"
                  value={typeLabel(singleSelectedAccount.accountType)}
                  sub={singleSelectedAccount.accountType}
                  valueClass="text-slate-100"
                />
              </>
            ) : (
              // Default: global portfolio stats.
              <>
                <StatTile
                  label="TWR"
                  value={toPercent(wStats.twr)}
                  sub={`${wStats.snapshotCount || 0} data points`}
                  valueClass={wStats.twr != null ? twrColor : 'text-slate-500'}
                  tooltip="Time-Weighted Return — removes the effect of deposits and withdrawals to measure pure investment performance. If TWR is much lower than Simple Return, most of the portfolio growth came from new deposits rather than market gains."
                />
                <StatTile
                  label="Simple return"
                  value={toPercent(wStats.simpleReturn)}
                  sub="includes deposits"
                  valueClass={wStats.simpleReturn != null ? retColor : 'text-slate-500'}
                  tooltip="(End Value − Start Value) / Start Value — not adjusted for cash flows. Inflated when large deposits occurred in the window."
                />
                <StatTile
                  label="Investment gain"
                  value={wStats.dollarGain != null ? formatCurrency(wStats.dollarGain) : '—'}
                  sub="excl. deposits & withdrawals"
                  valueClass={wStats.dollarGain != null
                    ? wStats.dollarGain >= 0 ? 'text-emerald-400' : 'text-red-400'
                    : 'text-slate-500'}
                  tooltip="Dollar return from market performance only: (End − Start − Net Deposits). Negative means the market lost money even if the portfolio grew (due to new contributions)."
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
              </>
            )}
          </div>

          {/* ── Portfolio value / per-account chart ────────────────────────── */}
          <Card>
            {/* Window controls (common to all modes) */}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">
                  {viewMode === 'account'
                    ? singleSelectedAccount
                      ? shortAccountName(singleSelectedAccount.accountName)
                      : `${accountSeries.filter((a) => isAccountSelected(a.accountId)).length} accounts`
                    : viewMode === 'type' && accountTypeFilter !== 'all'
                    ? typeLabel(accountTypeFilter)
                    : 'Total net worth'}
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold text-slate-100">
                  {viewMode === 'account'
                    ? singleAcctCurrentValue != null
                      ? formatCurrency(singleAcctCurrentValue)
                      : '—'
                    : windowedSeries.length
                    ? formatCurrency(windowedSeries[windowedSeries.length - 1].total)
                    : '—'}
                </p>
                {viewMode !== 'account' && windowedSeries.length >= 2 ? (
                  <p className={`text-sm font-mono ${wStats.simpleReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {toPercent(wStats.simpleReturn)} simple · {toPercent(wStats.twr)} TWR
                    {wStats.simpleReturn != null && wStats.twr != null &&
                      Math.abs(wStats.simpleReturn - wStats.twr) > 0.05 ? (
                      <span className="ml-1.5 text-slate-500 text-xs font-sans">gap = deposits</span>
                    ) : null}
                  </p>
                ) : viewMode === 'account' && singleAcctSimpleReturn != null ? (
                  <p className={`text-sm font-mono ${singleAcctSimpleReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {toPercent(singleAcctSimpleReturn)} simple return
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

            {/* Benchmark toggle — hidden in By Account mode */}
            {viewMode !== 'account' && (
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
            )}

            {/* ── Chart area ───────────────────────────────────────────────── */}
            {viewMode === 'account' ? (
              /* Per-account line chart */
              accountChartData.length < 2 ? (
                <p className="py-12 text-center text-sm text-slate-400">
                  Not enough data in this window.
                  {accountSeries.length > 0 && ' Try importing Composer history on the Import page.'}
                </p>
              ) : (
                <>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={accountChartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="date"
                          ticks={accountXAxisTicks}
                          tickFormatter={formatAxisTick}
                          tick={{ fill: '#94a3b8', fontSize: 11 }}
                          axisLine={{ stroke: '#334155' }}
                          tickLine={false}
                          minTickGap={32}
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
                              labelFormatter={formatDate}
                              valueFormatter={(v) => formatCurrency(v)}
                            />
                          }
                          cursor={{ stroke: '#475569', strokeWidth: 1 }}
                        />
                        {/* Year boundary markers */}
                        {accountYearMarkers.map((m) => (
                          <ReferenceLine
                            key={`yr-acct-${m.year}`}
                            x={m.date}
                            stroke="#374151"
                            strokeDasharray="3 3"
                            label={{ value: m.year, position: 'insideTopRight', fill: '#6b7280', fontSize: 10 }}
                          />
                        ))}
                        {accountSeries
                          .filter((a) => isAccountSelected(a.accountId))
                          .map((acct, i) => (
                            <Line
                              key={acct.accountId}
                              type="monotone"
                              dataKey={acct.accountId}
                              name={shortAccountName(acct.accountName)}
                              stroke={ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length]}
                              strokeWidth={2}
                              dot={false}
                              connectNulls
                              activeDot={{ r: 4, stroke: CARD_SURFACE, strokeWidth: 2 }}
                            />
                          ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Legend — hover to reveal ✏ rename button */}
                  <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                    {accountSeries
                      .filter((a) => isAccountSelected(a.accountId))
                      .map((acct, i) => {
                        const color    = ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length];
                        const isEditing = editingAccountId === acct.accountId;
                        return (
                          <li key={acct.accountId} className="group flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ background: color }}
                            />
                            {isEditing ? (
                              /* Inline rename form */
                              <span className="flex items-center gap-1">
                                <input
                                  className="w-36 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      renameMutation.mutate({ accountId: acct.accountId, displayName: editingName });
                                    }
                                    if (e.key === 'Escape') setEditingAccountId(null);
                                  }}
                                  // eslint-disable-next-line jsx-a11y/no-autofocus
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  title="Save alias"
                                  disabled={renameMutation.isPending}
                                  className="px-0.5 text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                                  onClick={() => renameMutation.mutate({ accountId: acct.accountId, displayName: editingName })}
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  title="Cancel"
                                  className="px-0.5 text-slate-400 hover:text-slate-200"
                                  onClick={() => setEditingAccountId(null)}
                                >
                                  ✗
                                </button>
                              </span>
                            ) : (
                              /* Normal display with hover-edit button */
                              <span className="flex items-center gap-1">
                                <span className="text-slate-400">{shortAccountName(acct.accountName)}</span>
                                <button
                                  type="button"
                                  title="Rename account"
                                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300 transition-opacity focus:opacity-100 leading-none"
                                  onClick={() => {
                                    // Pre-fill with current alias (empty if none set)
                                    setEditingAccountId(acct.accountId);
                                    setEditingName(acct.displayName ?? '');
                                  }}
                                >
                                  ✏
                                </button>
                              </span>
                            )}
                            <span className="text-slate-600">{acct.data.length} pts</span>
                          </li>
                        );
                      })}
                  </ul>
                </>
              )
            ) : (
              /* Aggregate / type-filtered chart (existing behavior) */
              windowedSeries.length < 2 ? (
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
                          ticks={xAxisTicks}
                          tickFormatter={formatAxisTick}
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
                              labelFormatter={formatDate}
                              valueFormatter={(v, name) =>
                                `${Number(v).toFixed(1)} (${name === 'portfolio' ? 'Portfolio' : benchmark})`
                              }
                            />
                          }
                          cursor={{ stroke: '#475569', strokeWidth: 1 }}
                        />
                        {/* Year boundary markers */}
                        {yearMarkers.map((m) => (
                          <ReferenceLine
                            key={`yr-norm-${m.year}`}
                            x={m.date}
                            stroke="#374151"
                            strokeDasharray="3 3"
                            label={{ value: m.year, position: 'insideTopRight', fill: '#6b7280', fontSize: 10 }}
                          />
                        ))}
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
                          ticks={xAxisTicks}
                          tickFormatter={formatAxisTick}
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
                              labelFormatter={formatDate}
                              valueFormatter={(v) => formatCurrency(v)}
                            />
                          }
                          cursor={{ stroke: '#475569', strokeWidth: 1 }}
                        />
                        {/* Year boundary markers */}
                        {yearMarkers.map((m) => (
                          <ReferenceLine
                            key={`yr-abs-${m.year}`}
                            x={m.date}
                            stroke="#374151"
                            strokeDasharray="3 3"
                            label={{ value: m.year, position: 'insideTopRight', fill: '#6b7280', fontSize: 10 }}
                          />
                        ))}
                        {/* Transfer reference lines */}
                        {transfersInWindow.map((t, i) => (
                          <ReferenceLine
                            key={`${t.date}-${i}`}
                            x={t.date}
                            stroke={t.amount >= 0 ? '#22c55e' : '#f59e0b'}
                            strokeDasharray="4 4"
                            label={{
                              value: `${t.amount >= 0 ? '▲' : '▼'} ${t.amount >= 0 ? '+' : ''}${formatCurrency(t.amount)}`,
                              fill:  t.amount >= 0 ? '#22c55e' : '#f59e0b',
                              fontSize: 10,
                              position: 'insideTopRight',
                            }}
                          />
                        ))}
                        <Area
                          type="monotone"
                          dataKey="total"
                          name={viewMode === 'type' && accountTypeFilter !== 'all'
                            ? typeLabel(accountTypeFilter)
                            : 'Net worth'}
                          stroke={viewMode === 'type' && accountTypeFilter !== 'all'
                            ? typeColor(accountTypeFilter)
                            : SERIES_BLUE}
                          strokeWidth={2}
                          fill="url(#perfFill)"
                          dot={false}
                          activeDot={{ r: 4, stroke: CARD_SURFACE, strokeWidth: 2 }}
                        />
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )
            )}
          </Card>

          {/* ── Stacked area by account type ─────────────────────────────── */}
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
                        ticks={stackedTicks}
                        tickFormatter={formatAxisTick}
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
                            labelFormatter={formatDate}
                            valueFormatter={(v) => formatCurrency(v)}
                          />
                        }
                        cursor={{ stroke: '#475569', strokeWidth: 1 }}
                      />
                      {/* Year boundary markers */}
                      {stackedMarkers.map((m) => (
                        <ReferenceLine
                          key={`yr-stacked-${m.year}`}
                          x={m.date}
                          stroke="#374151"
                          strokeDasharray="3 3"
                          label={{ value: m.year, position: 'insideTopRight', fill: '#6b7280', fontSize: 10 }}
                        />
                      ))}
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

          {/* ── Monthly return heatmap ────────────────────────────────────── */}
          <Card>
            <h3 className="mb-4 text-lg font-semibold">Monthly Return Heatmap</h3>
            <p className="mb-3 text-xs text-slate-500">
              Returns are TWR-adjusted for any logged transfers in each period.
            </p>
            <MonthlyHeatmap data={data?.monthlyReturns} isLoading={perfQuery.isLoading} />
          </Card>

          {/* ── Drawdown chart ────────────────────────────────────────────── */}
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
                      ticks={drawdownTicks}
                      tickFormatter={formatAxisTick}
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
                          labelFormatter={formatDate}
                          valueFormatter={(v) => `${Number(v).toFixed(2)}%`}
                        />
                      }
                      cursor={{ stroke: '#475569', strokeWidth: 1 }}
                    />
                    {/* Year boundary markers */}
                    {drawdownMarkers.map((m) => (
                      <ReferenceLine
                        key={`yr-dd-${m.year}`}
                        x={m.date}
                        stroke="#374151"
                        strokeDasharray="3 3"
                        label={{ value: m.year, position: 'insideTopRight', fill: '#6b7280', fontSize: 10 }}
                      />
                    ))}
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
