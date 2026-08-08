import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  Pencil,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';

import IncludeToggle from '../components/shared/IncludeToggle';

import apiClient from '../api/client';
import Skeleton from '../components/shared/Skeleton';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useActiveProfile } from '../store/useActiveProfile';
import { formatCurrency } from '../lib/accountTypes';

// ─── constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'housing',       label: 'Housing',       icon: '🏠' },
  { value: 'utilities',     label: 'Utilities',     icon: '💡' },
  { value: 'insurance',     label: 'Insurance',     icon: '🛡️' },
  { value: 'food',          label: 'Food',          icon: '🛒' },
  { value: 'transport',     label: 'Transport',     icon: '🚗' },
  { value: 'healthcare',    label: 'Healthcare',    icon: '🏥' },
  { value: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { value: 'travel',        label: 'Travel',        icon: '✈️' },
  { value: 'debt',          label: 'Debt',          icon: '📄' },
  { value: 'subscriptions', label: 'Subscriptions', icon: '📱' },
  { value: 'other',         label: 'Other',         icon: '📦' },
];

const INCOME_TYPE_LABELS = {
  social_security: '🏛️ Social Security',
  pension:         '🏦 Pension',
  annuity:         '📋 Annuity',
  rental:          '🏢 Rental',
  employment:      '💼 Employment',
  other:           '⚡ Other',
};

const EMPTY_EXPENSE = {
  name:                    '',
  category:                'other',
  monthly_amount:          '',
  continues_in_retirement: true,
  retirement_amount:       '',
  notes:                   '',
};

function catMeta(value) {
  return CATEGORIES.find((c) => c.value === value) || CATEGORIES[CATEGORIES.length - 1];
}

const selectCls =
  'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ' +
  'focus:border-sky-500 focus:outline-none';

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, main, sub, accent }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent || 'text-slate-100'}`}>{main}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-400">{sub}</div> : null}
    </Card>
  );
}

// ─── expense modal ────────────────────────────────────────────────────────────

function ExpenseModal({ initial, onClose, onSaved }) {
  const [form,  setForm]  = useState(() => initial ? {
    name:                    initial.name || '',
    category:                initial.category || 'other',
    monthly_amount:          String(initial.monthly_amount ?? ''),
    continues_in_retirement: initial.continues_in_retirement !== false,
    retirement_amount:       initial.retirement_amount != null ? String(initial.retirement_amount) : '',
    notes:                   initial.notes || '',
  } : EMPTY_EXPENSE);
  const [error, setError] = useState('');

  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name:                    form.name.trim(),
        category:                form.category,
        monthly_amount:          Number(form.monthly_amount) || 0,
        continues_in_retirement: form.continues_in_retirement,
        retirement_amount:       form.retirement_amount !== '' ? Number(form.retirement_amount) : null,
        notes:                   form.notes.trim() || null,
      };
      if (initial?.id && initial.source !== 'real_estate') {
        return apiClient.put(`/cashflow/expenses/${initial.id}`, payload);
      }
      return apiClient.post('/cashflow/expenses', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashflow-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-summary'] });
      onSaved();
    },
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save'),
  });

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target?.value ?? e }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-100">
            {initial ? 'Edit Expense' : 'Add Expense'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="block text-sm text-slate-400">Name</label>
            <Input
              value={form.name}
              onChange={set('name')}
              placeholder="e.g. PG&E, Health Insurance"
              autoFocus
            />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <label className="block text-sm text-slate-400">Category</label>
            <select className={selectCls} value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>

          {/* Monthly amount */}
          <div className="space-y-1.5">
            <label className="block text-sm text-slate-400">Monthly amount ($)</label>
            <Input
              type="number"
              min="0"
              step="10"
              value={form.monthly_amount}
              onChange={set('monthly_amount')}
              placeholder="350"
            />
          </div>

          {/* Continues in retirement */}
          <div className="space-y-2">
            <div className="text-sm text-slate-400">Continues in retirement?</div>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.continues_in_retirement}
                onChange={(e) => setForm((prev) => ({ ...prev, continues_in_retirement: e.target.checked }))}
                className="accent-sky-500"
              />
              Yes — this expense continues after I retire
            </label>
            {form.continues_in_retirement && (
              <div className="ml-6 space-y-1.5">
                <label className="block text-xs text-slate-500">
                  Retirement amount (optional — leave blank if same)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="10"
                  value={form.retirement_amount}
                  onChange={set('retirement_amount')}
                  placeholder="same as today"
                  className="w-40"
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block text-sm text-slate-400">Notes (optional)</label>
            <Input value={form.notes} onChange={set('notes')} placeholder="optional" />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">
            Cancel
          </button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name.trim() || form.monthly_amount === ''}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Expense'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── income column ────────────────────────────────────────────────────────────

function IncomeColumn({ sources, totalGross, totalNet, view, retirementAge }) {
  if (sources.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        No income sources active {view === 'today' ? 'now' : 'at retirement'}.{' '}
        <Link to="/income" className="text-sky-400 hover:underline">Add one →</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sources.map((src, i) => {
        const hasGross  = src.gross != null;
        const typeLabel = INCOME_TYPE_LABELS[src.type] || src.type;
        return (
          <div key={i} className="rounded-lg border border-slate-800 bg-slate-800/40 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-slate-100 truncate">{src.name}</div>
                <div className="text-xs text-slate-500">{typeLabel}</div>
              </div>
              <div className="text-right shrink-0">
                {hasGross && (
                  <div className="text-xs text-slate-500">
                    Gross: {formatCurrency(src.gross)}
                  </div>
                )}
                <div className="font-semibold text-sky-300">{formatCurrency(src.net)}</div>
                {hasGross && (
                  <div className="text-xs text-slate-500">
                    {Math.round((src.net / src.gross) * 100)}% effective net
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Total row */}
      <div className="rounded-lg border border-slate-700 px-4 py-3 mt-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium text-slate-300">Total</span>
          <div className="text-right">
            {totalGross !== totalNet && (
              <div className="text-xs text-slate-500">Gross: {formatCurrency(totalGross)}</div>
            )}
            <div className="font-bold text-sky-300">{formatCurrency(totalNet)}/mo</div>
          </div>
        </div>
      </div>

      {view === 'retirement' && retirementAge && (
        <p className="text-xs text-slate-500 text-center">
          Income projected at retirement age {retirementAge}
        </p>
      )}
    </div>
  );
}

// ─── expenses column ──────────────────────────────────────────────────────────

function ExpensesColumn({ items, byCategory, total, view, onAdd, onEdit, onDelete, onToggle }) {
  // Group by category — show all items (including excluded ones)
  const grouped = useMemo(() => {
    const groups = {};
    for (const item of items) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return groups;
  }, [items]);

  const catOrder = CATEGORIES.map((c) => c.value).filter((v) => grouped[v]);

  return (
    <div className="space-y-4">
      {catOrder.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">
          No expenses yet.{' '}
          <button type="button" onClick={onAdd} className="text-sky-400 hover:underline">
            Add your first bill →
          </button>
        </div>
      ) : (
        catOrder.map((cat) => {
          const meta  = catMeta(cat);
          const group = grouped[cat];
          return (
            <div key={cat}>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
                <span className="ml-auto text-slate-400">{formatCurrency(byCategory[cat] || 0)}</span>
              </div>
              <div className="space-y-1">
                {group.map((item, i) => {
                  const isExcluded = item.is_active === false;
                  const isManual   = item.source !== 'real_estate';
                  return (
                    <div
                      key={i}
                      className={`group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-slate-800/60 transition-opacity ${isExcluded ? 'opacity-50' : ''}`}
                    >
                      <span className={`flex-1 truncate text-sm ${isExcluded ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                        {item.name}
                      </span>
                      {item.source === 'real_estate' && (
                        <span className="text-xs text-slate-600 shrink-0">🏠 RE</span>
                      )}
                      <span className={`shrink-0 text-sm font-medium ${isExcluded ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                        {formatCurrency(item.monthly_amount)}
                      </span>
                      {isManual ? (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <IncludeToggle
                            included={!isExcluded}
                            onToggle={(val) => onToggle(item, val)}
                            size="sm"
                          />
                          <button
                            type="button"
                            onClick={() => onEdit(item)}
                            className="text-slate-500 hover:text-sky-400 p-1"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(item.id)}
                            className="text-slate-500 hover:text-red-400 p-1"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : <div className="w-9" />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* Total */}
      {items.length > 0 && (
        <div className="flex items-center justify-between border-t border-slate-800 pt-3 font-medium">
          <span className="text-slate-300">Total</span>
          <span className="text-slate-100">{formatCurrency(total)}/mo</span>
        </div>
      )}

      {/* Add button at bottom of column */}
      {view === 'today' && (
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-700 py-2 text-sm text-slate-500 hover:border-sky-500 hover:text-sky-400 transition-colors"
        >
          <Plus size={14} /> Add expense
        </button>
      )}
    </div>
  );
}

// ─── flow bar ─────────────────────────────────────────────────────────────────

function FlowBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32 shrink-0 text-slate-400">{label}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-slate-800 h-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="w-28 shrink-0 text-right font-medium text-slate-200">
        {formatCurrency(value)}/mo
      </span>
    </div>
  );
}

// ─── tax disclaimer banner ────────────────────────────────────────────────────

function TaxBanner({ estimate }) {
  if (!estimate || estimate.estimatedMonthlyTax <= 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
      <span className="text-amber-400 shrink-0">⚠️</span>
      <span className="text-amber-200/80">
        <strong>Estimated tax deduction:</strong>{' '}
        {formatCurrency(estimate.estimatedMonthlyTax)}/mo ({estimate.effectiveRate}% effective rate on taxable income).
        Based on {estimate.filingStatus} 2026 brackets with ${(estimate.standardDeduction || 0).toLocaleString()} standard deduction.{' '}
        <em>{estimate.note}</em>
      </span>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function CashFlow() {
  const pid          = useActiveProfile();
  const queryClient  = useQueryClient();

  const [view,    setView]    = useState('today');   // 'today' | 'retirement'
  const [modal,   setModal]   = useState(null);      // null | 'new' | expense-object
  const [filing,  setFiling]  = useState('single');  // for tax estimate

  // ── data fetching ──────────────────────────────────────────────────────────

  const summaryQuery = useQuery({
    queryKey: ['cashflow-summary', pid, filing],
    queryFn:  async () => (await apiClient.get(
      `/cashflow/summary?filingStatus=${filing}`
    )).data,
  });

  const expensesQuery = useQuery({
    queryKey: ['cashflow-expenses', pid],
    queryFn:  async () => (await apiClient.get('/cashflow/expenses')).data,
  });

  // ── mutations ──────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/cashflow/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashflow-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-summary'] });
    },
  });

  const toggleExpenseMutation = useMutation({
    mutationFn: async ({ id, included }) =>
      apiClient.patch(`/cashflow/expenses/${id}/toggle`, { included }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashflow-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-summary'] });
    },
  });

  // ── derived data ───────────────────────────────────────────────────────────

  const summary = summaryQuery.data;
  const expenses = expensesQuery.data || [];

  const isToday      = view === 'today';
  const section      = isToday ? summary?.today : summary?.atRetirement;
  const income       = section?.income;
  const expSection   = section?.expenses;
  const disposable   = section?.disposable ?? 0;
  const savingsRate  = isToday ? (summary?.today?.savingsRate ?? 0) : null;

  // Expense items for display: use expensesQuery (includes excluded items) for Today view;
  // At Retirement view uses the summary's filtered items (only continuing & active).
  const displayExpenseItems = isToday
    ? expenses
    : (expSection?.items ?? []);

  // For loading skeleton
  const isLoading = summaryQuery.isLoading || expensesQuery.isLoading;

  const barMax = Math.max(income?.net ?? 0, income?.gross ?? 0, 1);

  const handleDelete = (id) => {
    if (window.confirm('Delete this expense?')) {
      deleteMutation.mutate(id);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Cash Flow</h1>
          <p className="mt-0.5 text-sm text-slate-400">Monthly income vs expenses</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Filing status (affects retirement tax estimate) */}
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-xs">
            {['single', 'married'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFiling(s)}
                className={`px-3 py-1.5 capitalize ${
                  filing === s
                    ? 'bg-slate-600 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Today / At Retirement toggle */}
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-sm">
            <button
              type="button"
              onClick={() => setView('today')}
              className={`px-4 py-1.5 ${
                isToday ? 'bg-sky-500 text-white' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setView('retirement')}
              className={`px-4 py-1.5 border-l border-slate-700 ${
                !isToday ? 'bg-sky-500 text-white' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              At Retirement
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-8 w-32" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Monthly Income (net)"
            main={formatCurrency(income?.net ?? 0)}
            sub={income?.gross && income.gross !== income.net
              ? `Gross: ${formatCurrency(income.gross)}`
              : undefined}
          />
          <StatCard
            label="Monthly Expenses"
            main={formatCurrency(expSection?.total ?? 0)}
            sub={!isToday ? 'Retirement expenses only' : undefined}
            accent="text-rose-300"
          />
          <StatCard
            label="Disposable Income"
            main={formatCurrency(disposable)}
            sub={savingsRate != null ? `${savingsRate}% savings rate` : undefined}
            accent={disposable >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          />
        </div>
      )}

      {/* At-retirement tax banner */}
      {!isToday && !isLoading && summary?.taxEstimate && (
        <TaxBanner estimate={summary.taxEstimate} />
      )}

      {/* Two-column layout */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <Skeleton className="h-5 w-20 mb-4" />
            {[0,1,2].map((i) => <Skeleton key={i} className="h-16 w-full mb-2" />)}
          </Card>
          <Card>
            <Skeleton className="h-5 w-20 mb-4" />
            {[0,1,2,3].map((i) => <Skeleton key={i} className="h-8 w-full mb-2" />)}
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* Income */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-100">
                <TrendingUp size={16} className="inline mr-2 text-sky-400" />
                Income
              </h2>
              <Link
                to="/income"
                className="text-xs text-sky-400 hover:underline"
              >
                Edit sources →
              </Link>
            </div>
            <IncomeColumn
              sources={income?.sources ?? []}
              totalGross={income?.gross ?? 0}
              totalNet={income?.net ?? 0}
              view={view}
              retirementAge={summary?.atRetirement?.retirementAge}
            />
          </Card>

          {/* Expenses */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-100">
                <TrendingDown size={16} className="inline mr-2 text-rose-400" />
                Expenses
              </h2>
              {isToday && (
                <Button
                  onClick={() => setModal('new')}
                  className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
                >
                  <Plus size={13} /> Add bill
                </Button>
              )}
            </div>
            <ExpensesColumn
              items={displayExpenseItems}
              byCategory={expSection?.byCategory ?? {}}
              total={expSection?.total ?? 0}
              view={view}
              onAdd={() => setModal('new')}
              onEdit={(item) => setModal(item)}
              onDelete={handleDelete}
              onToggle={(item, included) => toggleExpenseMutation.mutate({ id: item.id, included })}
            />
          </Card>
        </div>
      )}

      {/* Flow bars */}
      {!isLoading && income && (
        <Card>
          <h2 className="mb-4 font-semibold text-slate-100">
            <DollarSign size={16} className="inline mr-1.5 text-slate-400" />
            Monthly Flow
          </h2>
          <div className="space-y-3">
            <FlowBar
              label="Net income"
              value={income.net ?? 0}
              max={barMax}
              color="#38bdf8"
            />
            <FlowBar
              label="Expenses"
              value={expSection?.total ?? 0}
              max={barMax}
              color="#f43f5e"
            />
            <FlowBar
              label="Disposable"
              value={Math.max(0, disposable)}
              max={barMax}
              color="#34d399"
            />
          </div>
          {!isToday && summary?.atRetirement?.retirementAge && (
            <p className="mt-3 text-xs text-slate-500 text-center">
              Projected at age {summary.atRetirement.retirementAge} · includes estimated tax deduction
            </p>
          )}
        </Card>
      )}

      {/* Empty state if nothing at all */}
      {!isLoading && !summary?.today?.income?.sources?.length && !displayExpenseItems.length && (
        <Card className="py-12 text-center">
          <p className="text-slate-400 text-sm">
            No data yet. <Link to="/income" className="text-sky-400 hover:underline">Add income sources</Link> and
            expenses above to see your cash flow picture.
          </p>
        </Card>
      )}

      {/* Expense modal */}
      {modal !== null && (
        <ExpenseModal
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => setModal(null)}
        />
      )}
    </div>
  );
}
