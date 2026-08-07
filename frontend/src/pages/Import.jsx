import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import apiClient from '../api/client';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { formatCurrency } from '../lib/accountTypes';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtDateLong(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });
}

// ─── Method cards (informational) ─────────────────────────────────────────────

function MethodCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-sky-700/50 bg-sky-900/10 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xl">📋</span>
          <h3 className="font-semibold text-sky-300">
            PDF Statements
            <span className="ml-2 rounded-full bg-sky-700/40 px-2 py-0.5 text-[11px] font-medium text-sky-400">
              Recommended
            </span>
          </h3>
        </div>
        <p className="text-sm text-slate-400">
          Download monthly account statements. Captures point-in-time balances — ideal for building
          net worth history. Select multiple months at once.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Fidelity.com → Accounts &amp; Trade → Statements &amp; Documents
        </p>
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xl">📊</span>
          <h3 className="font-semibold text-slate-300">CSV Activity</h3>
        </div>
        <p className="text-sm text-slate-400">
          Download account history as a CSV export. Captures individual transactions — useful for
          detailed activity and performance tracking.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Fidelity.com → Accounts &amp; Trade → Account History → Download
        </p>
      </div>
    </div>
  );
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onFiles, hasFiles }) {
  const inputRef  = useRef(null);
  const [dragging, setDragging] = useState(false);

  function processInput(fileList) {
    const valid = [...fileList].filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith('.pdf') || n.endsWith('.csv');
    });
    if (valid.length) onFiles(valid);
  }

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
        dragging
          ? 'border-sky-400 bg-sky-500/10'
          : hasFiles
          ? 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/40'
          : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/40'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); processInput(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.csv,application/pdf,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => { processInput(Array.from(e.target.files)); e.target.value = ''; }}
      />
      <div className="text-3xl text-slate-500">↑</div>
      {hasFiles ? (
        <>
          <p className="text-sm text-slate-300">Drop PDFs or CSVs here, or click to browse</p>
          <p className="text-xs text-slate-500">Hold Ctrl/Cmd to select multiple files · max 10 MB each</p>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-300">Drop PDFs or CSVs here, or click to browse</p>
          <p className="text-xs text-slate-500">Hold Ctrl/Cmd to select multiple files · max 10 MB each</p>
        </>
      )}
    </div>
  );
}

// ─── CSV review table ─────────────────────────────────────────────────────────

function CSVReviewTable({ preview, selections, onToggle, onToggleAll }) {
  const matchedAccounts = preview.accounts.filter((a) => a.matchedAccount);
  const allChecked  = matchedAccounts.length > 0 && matchedAccounts.every((a) => selections.has(a.csvAccountName));
  const someChecked = matchedAccounts.some((a) => selections.has(a.csvAccountName));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/80">
            <tr>
              <th className="px-3 py-2 text-left">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-sky-500"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                  onChange={() => onToggleAll(!allChecked)}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Account</th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Number</th>
              <th className="px-3 py-2 text-right text-slate-400 font-medium">Txns</th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Date Range</th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Match</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {preview.accounts.map((acct) => {
              const hasMatch = Boolean(acct.matchedAccount);
              const selected = hasMatch && selections.has(acct.csvAccountName);
              return (
                <tr
                  key={acct.csvAccountName}
                  className={`transition-colors ${
                    hasMatch ? 'cursor-pointer hover:bg-slate-800/40' : 'opacity-40 cursor-not-allowed'
                  } ${!selected && hasMatch ? 'opacity-60' : ''}`}
                  onClick={() => hasMatch && onToggle(acct.csvAccountName)}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-500"
                      style={{ cursor: hasMatch ? 'pointer' : 'not-allowed' }}
                      checked={selected}
                      disabled={!hasMatch}
                      onChange={() => hasMatch && onToggle(acct.csvAccountName)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-200">{acct.csvAccountName}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{acct.csvAccountNumber || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{acct.transactionCount}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-400">
                    {acct.dateRange?.earliest === acct.dateRange?.latest
                      ? fmtDateShort(acct.dateRange?.earliest)
                      : `${fmtDate(acct.dateRange?.earliest)} – ${fmtDate(acct.dateRange?.latest)}`}
                  </td>
                  <td className="px-3 py-2.5">
                    {acct.matchedAccount ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        ✓ <span className="max-w-[120px] truncate">{acct.matchedAccount.name}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/60 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                        no match — will skip
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {preview.warnings?.length > 0 && (
        <div className="space-y-0.5">
          {preview.warnings.map((w, i) => <p key={i} className="text-xs text-amber-400">⚠ {w}</p>)}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Unmatched accounts are skipped. Add them on the{' '}
        <a href="/accounts" className="underline hover:text-slate-300">Accounts page</a> to import them.
        Accounts excluded from tracking are pre-unchecked.
      </p>
    </div>
  );
}

// ─── PDF review table ─────────────────────────────────────────────────────────

function PDFReviewTable({ preview, selections, onToggle, onToggleAll }) {
  const allChecked  = preview.accounts.length > 0 && preview.accounts.every((a) => selections.has(a.accountNumber));
  const someChecked = preview.accounts.some((a) => selections.has(a.accountNumber));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/80">
            <tr>
              <th className="px-3 py-2 text-left">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-sky-500"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                  onChange={() => onToggleAll(!allChecked)}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Account</th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Number</th>
              <th className="px-3 py-2 text-right text-slate-400 font-medium">Ending Balance</th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Match</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {preview.accounts.map((acct) => {
              const selected = selections.has(acct.accountNumber);
              return (
                <tr
                  key={acct.accountNumber}
                  className={`cursor-pointer transition-colors hover:bg-slate-800/40 ${!selected ? 'opacity-60' : ''}`}
                  onClick={() => onToggle(acct.accountNumber)}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-sky-500"
                      checked={selected}
                      onChange={() => onToggle(acct.accountNumber)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="max-w-[200px] px-3 py-2.5">
                    <span className="block truncate font-medium text-slate-200" title={acct.accountName}>
                      {acct.accountName}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{acct.accountNumber}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-100">
                    {formatCurrency(acct.endingBalance)}
                  </td>
                  <td className="px-3 py-2.5">
                    {acct.matchedAccount ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        ✓ <span className="max-w-[110px] truncate">{acct.matchedAccount.name}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                        + will create account
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {preview.warnings?.length > 0 && (
        <div className="space-y-0.5">
          {preview.warnings.map((w, i) => <p key={i} className="text-xs text-amber-400">⚠ {w}</p>)}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Snapshot written to <span className="text-slate-400">{fmtDateShort(preview.statementDate)}</span>.
        Unmatched accounts are created automatically.
      </p>
    </div>
  );
}

// ─── File section (one collapsible card per file) ─────────────────────────────

function FileSection({ item, onToggleSelection, onToggleAll, onRemove }) {
  const [expanded, setExpanded] = useState(true);
  const { file, status, preview, selections, result, error } = item;
  const isPDF = preview?.format === 'fidelity_pdf';

  // ── Section header label ──────────────────────────────────────────────────
  let label, meta;
  if (status === 'previewing') {
    label = file.name;
    meta  = null;
  } else if (status === 'preview_error') {
    label = file.name;
    meta  = null;
  } else if (isPDF) {
    label = fmtDateLong(preview.statementDate);
    meta  = `${formatCurrency(preview.totalValue)}  ·  ${preview.accounts.length} account${preview.accounts.length === 1 ? '' : 's'}`;
  } else {
    label = file.name;
    meta  = `${preview.accounts.length} account${preview.accounts.length === 1 ? '' : 's'}  ·  ${preview.totalTransactions} transactions`;
  }

  const selectionSummary = status === 'ready'
    ? `${selections.size} selected`
    : status === 'done' && isPDF
    ? `1 snapshot · ${formatCurrency(result?.totalValue)}`
    : status === 'done'
    ? `${result?.transactionsImported ?? 0} transactions`
    : null;

  // ── Border colour per status ──────────────────────────────────────────────
  const borderClass = status === 'done'        ? 'border-emerald-700/60'
                    : status === 'import_error' ? 'border-red-800/60'
                    : status === 'preview_error'? 'border-red-800/60'
                    : status === 'importing'    ? 'border-sky-700/60'
                    : 'border-slate-700';

  return (
    <div className={`rounded-xl border ${borderClass} bg-slate-900/60`}>

      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-3">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <span className="shrink-0 text-xs text-slate-500 w-3">{expanded ? '▼' : '▶'}</span>

          {/* Status icon */}
          {status === 'previewing' && (
            <span className="shrink-0 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          )}
          {status === 'importing' && (
            <span className="shrink-0 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          )}
          {status === 'done' && (
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">✓</span>
          )}
          {(status === 'preview_error' || status === 'import_error') && (
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-800 text-[10px] font-bold text-white">✗</span>
          )}

          {/* Label + meta */}
          <div className="min-w-0">
            <span className="block truncate font-semibold text-slate-100">{label}</span>
            {meta ? <span className="block text-xs text-slate-400">{meta}</span> : null}
          </div>
        </button>

        {/* Right side: selection summary + remove */}
        <div className="flex shrink-0 items-center gap-3">
          {selectionSummary ? (
            <span className="hidden text-xs text-slate-500 sm:block">{selectionSummary}</span>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:text-red-400 transition-colors"
            title="Remove"
            aria-label="Remove file"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-slate-800 px-4 py-4">
          {status === 'previewing' && (
            <p className="text-sm text-slate-400">Parsing file…</p>
          )}

          {status === 'preview_error' && (
            <p className="text-sm text-red-400">{error || 'Could not parse file.'}</p>
          )}

          {status === 'ready' && isPDF && (
            <PDFReviewTable
              preview={preview}
              selections={selections}
              onToggle={(key) => onToggleSelection(item.id, key)}
              onToggleAll={(checked) => onToggleAll(item.id, checked)}
            />
          )}

          {status === 'ready' && !isPDF && (
            <CSVReviewTable
              preview={preview}
              selections={selections}
              onToggle={(key) => onToggleSelection(item.id, key)}
              onToggleAll={(checked) => onToggleAll(item.id, checked)}
            />
          )}

          {status === 'importing' && (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
              Importing…
            </p>
          )}

          {status === 'done' && isPDF && (
            <div className="text-sm text-emerald-300 space-y-1">
              <p className="font-medium">
                ✓ Snapshot recorded for {fmtDateShort(result?.statementDate)} · {formatCurrency(result?.totalValue)}
              </p>
              <p className="text-xs text-slate-400">
                {result?.accountsMatched} matched
                {result?.accountsCreated > 0 ? ` · ${result.accountsCreated} created` : ''}
                {result?.warnings?.length > 0 ? ` · ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          )}

          {status === 'done' && !isPDF && (
            <div className="text-sm text-emerald-300 space-y-1">
              <p className="font-medium">
                ✓ {result?.transactionsImported ?? 0} transaction{result?.transactionsImported === 1 ? '' : 's'} imported
                {result?.snapshotsCreated > 0 ? ` · ${result.snapshotsCreated} snapshot${result.snapshotsCreated === 1 ? '' : 's'} created` : ''}
              </p>
              <p className="text-xs text-slate-400">
                {result?.accountsMatched} matched
                {result?.accountsUnmatched > 0 ? ` · ${result.accountsUnmatched} unmatched` : ''}
              </p>
            </div>
          )}

          {status === 'import_error' && (
            <p className="text-sm text-red-400">{error || 'Import failed.'}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Composer NAV history backfill ───────────────────────────────────────────

function ComposerHistorySection() {
  const queryClient = useQueryClient();
  const navigate    = useNavigate();
  const [result, setResult] = useState(null);
  const [error,  setError]  = useState(null);

  // Query accounts so we can show a live Composer account count.
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn:  async () => (await apiClient.get('/accounts')).data,
    staleTime: 60_000,
  });

  const composerAccounts = (accountsQuery.data || []).filter(
    (a) => a.type === 'composer' || a.source === 'composer'
  );

  const backfillMutation = useMutation({
    mutationFn: async () => (await apiClient.post('/performance/backfill-composer')).data,
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      // Invalidate performance data so the chart refreshes.
      queryClient.invalidateQueries({ queryKey: ['performance'] });
    },
    onError: (err) => {
      setError(err?.response?.data?.error || 'Import failed — please try again.');
      setResult(null);
    },
  });

  if (composerAccounts.length === 0 && !accountsQuery.isLoading) {
    // No Composer accounts connected — don't show the card.
    return null;
  }

  return (
    <section>
      <div className="rounded-xl border border-indigo-700/40 bg-indigo-900/10 p-5 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-2xl">📈</span>
          <div>
            <h3 className="font-semibold text-indigo-300">Import Composer NAV History</h3>
            <p className="mt-1 text-sm text-slate-400">
              Pull complete daily portfolio history from your connected Composer accounts going
              back to account open date. This gives the Performance page a dense daily chart
              instead of sparse snapshots.
            </p>
          </div>
        </div>

        {/* Account summary */}
        {!accountsQuery.isLoading && composerAccounts.length > 0 && !result && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-300">
              <span>
                <span className="text-slate-500">Accounts: </span>
                {composerAccounts.length} connected
              </span>
              <span>
                <span className="text-slate-500">Expected coverage: </span>
                ~479 data points per account (from account open)
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
              {composerAccounts.map((a) => (
                <span key={a.id}>• {a.name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Pending (importing) state */}
        {backfillMutation.isPending && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
              Fetching history from Composer API… this may take 10–30 seconds.
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Respecting the 1 req/sec rate limit between accounts.
            </p>
          </div>
        )}

        {/* Success result */}
        {result && !backfillMutation.isPending && (
          <div className="rounded-lg border border-emerald-700/50 bg-emerald-900/15 px-4 py-3 space-y-2">
            <p className="font-medium text-emerald-300">
              ✓ Imported {result.rowsInserted?.toLocaleString()} data points across{' '}
              {result.accountsProcessed} account{result.accountsProcessed === 1 ? '' : 's'}
            </p>
            {result.dateRange?.earliest && (
              <p className="text-sm text-slate-400">
                Coverage:{' '}
                {new Date(result.dateRange.earliest + 'T00:00:00').toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}{' '}
                →{' '}
                {new Date(result.dateRange.latest + 'T00:00:00').toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </p>
            )}
            {result.accounts?.length > 0 && (
              <div className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-slate-500">
                {result.accounts.map((a) => (
                  <span key={a.name}>
                    {a.name}: {a.pointCount?.toLocaleString()} pts
                    {a.error ? <span className="text-red-400"> (error)</span> : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => { setResult(null); setError(null); backfillMutation.mutate(); }}
            disabled={backfillMutation.isPending || composerAccounts.length === 0}
            className="bg-indigo-700 hover:bg-indigo-600 text-sm"
          >
            {backfillMutation.isPending
              ? 'Importing…'
              : result
              ? 'Re-import Composer History'
              : 'Import Composer History'}
          </Button>
          {result && (
            <Button
              onClick={() => navigate('/performance')}
              className="bg-slate-700 hover:bg-slate-600 text-sm"
            >
              View Performance →
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Import history ───────────────────────────────────────────────────────────

function ImportHistory() {
  const queryClient = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);

  const historyQuery = useQuery({
    queryKey: ['import-history'],
    queryFn: async () => (await apiClient.get('/import/history')).data,
  });

  const [clearing, setClearing] = useState(false);
  async function clearHistory() {
    setClearing(true);
    try {
      await apiClient.delete('/import/history');
      queryClient.invalidateQueries({ queryKey: ['import-history'] });
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  const history = historyQuery.data || [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Import History</h3>
        {history.length > 0 && (
          <Button
            className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
            onClick={() => setConfirmClear(true)}
          >
            Clear History
          </Button>
        )}
      </div>

      {historyQuery.isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-slate-800" />
      ) : history.length === 0 ? (
        <Card><p className="text-sm text-slate-400">No imports yet.</p></Card>
      ) : (
        <div className="space-y-2">
          {history.map((item) => {
            const isPDF = item.format === 'fidelity_pdf';
            return (
              <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-200">{item.filename || 'File'}</p>
                      {isPDF && (
                        <span className="rounded-full bg-sky-700/30 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">PDF</span>
                      )}
                    </div>
                    {isPDF ? (
                      <p className="text-xs text-slate-400">
                        Snapshot · {item.date_earliest ? fmtDateShort(item.date_earliest) : 'unknown date'}
                        {' · '}{item.accounts_matched} matched
                        {item.accounts_unmatched > 0 ? ` · ${item.accounts_unmatched} created` : ''}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400">
                        {item.transactions_imported} transaction{item.transactions_imported === 1 ? '' : 's'}
                        {item.snapshots_created > 0 ? ` · ${item.snapshots_created} snapshot${item.snapshots_created === 1 ? '' : 's'}` : ''}
                        {item.date_earliest ? ` · ${fmtDate(item.date_earliest)}` : ''}
                        {item.date_latest && item.date_latest !== item.date_earliest ? ` – ${fmtDate(item.date_latest)}` : ''}
                      </p>
                    )}
                    {item.accounts_unmatched > 0 && !isPDF && (
                      <p className="mt-0.5 text-xs text-amber-400">
                        {item.accounts_unmatched} unmatched account{item.accounts_unmatched === 1 ? '' : 's'}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(item.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </p>
                </div>
                {item.warnings?.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-amber-400">
                      {item.warnings.length} warning{item.warnings.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {item.warnings.map((w, i) => (
                        <li key={i} className="text-xs text-slate-400">• {w}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmClear}
        title="Clear import history?"
        message="This removes the import log entries only — your imported transactions and snapshots are kept."
        confirmLabel="Clear History"
        confirmStyle="warning"
        onConfirm={clearHistory}
        onCancel={() => setConfirmClear(false)}
      />
    </section>
  );
}

// ─── Compute how many selections will actually be imported for an item ─────────

function effectiveCount(item) {
  if (!item.preview || item.status !== 'ready') return 0;
  if (item.preview.format === 'fidelity_pdf') {
    return [...item.selections].filter((num) =>
      item.preview.accounts.find((a) => a.accountNumber === num)
    ).length;
  }
  // CSV: only matched accounts count
  return [...item.selections].filter((name) =>
    item.preview.accounts.find((a) => a.csvAccountName === name)?.matchedAccount
  ).length;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Import() {
  const queryClient = useQueryClient();
  const navigate    = useNavigate();

  // Array of per-file state objects
  // { id, file, status, preview, selections, result, error }
  const [fileItems, setFileItems] = useState([]);
  const [processing, setProcessing] = useState(false); // true while any async op is running

  // Derived flags
  const hasFiles      = fileItems.length > 0;
  const anyPreviewing = fileItems.some((i) => i.status === 'previewing');
  const anyImporting  = fileItems.some((i) => i.status === 'importing');
  const readyItems    = fileItems.filter((i) => i.status === 'ready');
  const doneItems     = fileItems.filter((i) => i.status === 'done');
  const totalReadySelections = readyItems.reduce((sum, i) => sum + effectiveCount(i), 0);

  // ── Add and preview files ─────────────────────────────────────────────────
  const addAndPreview = useCallback(async (newFiles) => {
    if (!newFiles.length) return;

    // Assign stable IDs
    const baseId = Date.now();
    const incoming = newFiles.map((f, idx) => ({
      id:         baseId + idx,
      file:       f,
      status:     'previewing',
      preview:    null,
      selections: new Set(),
      result:     null,
      error:      null,
    }));

    setFileItems((prev) => [...prev, ...incoming]);
    setProcessing(true);

    for (const item of incoming) {
      try {
        const form = new FormData();
        form.append('file', item.file);
        const data = (await apiClient.post('/import/preview', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })).data;

        // Default selections
        let selections;
        if (data.format === 'fidelity_pdf') {
          selections = new Set(
            data.accounts
              .filter((a) => !a.matchedAccount || a.matchedAccount.include_in_tracking !== false)
              .map((a) => a.accountNumber)
          );
        } else {
          selections = new Set(
            data.accounts
              .filter((a) => a.matchedAccount && a.matchedAccount.include_in_tracking !== false)
              .map((a) => a.csvAccountName)
          );
        }

        setFileItems((prev) =>
          prev.map((i) => i.id === item.id ? { ...i, status: 'ready', preview: data, selections } : i)
        );
      } catch (err) {
        const msg = err?.response?.data?.error || 'Could not parse file — check the format and try again.';
        setFileItems((prev) =>
          prev.map((i) => i.id === item.id ? { ...i, status: 'preview_error', error: msg } : i)
        );
      }
    }

    setProcessing(false);
  }, []);

  // ── Import all ready items ────────────────────────────────────────────────
  async function importAll() {
    const toImport = fileItems.filter((i) => i.status === 'ready' && effectiveCount(i) > 0);
    if (!toImport.length) return;

    setProcessing(true);

    for (const item of toImport) {
      setFileItems((prev) =>
        prev.map((i) => i.id === item.id ? { ...i, status: 'importing' } : i)
      );

      try {
        const form   = new FormData();
        const isPDF  = item.preview?.format === 'fidelity_pdf';
        form.append('file', item.file);
        if (isPDF) {
          form.append('selectedAccountNumbers', JSON.stringify([...item.selections]));
        } else {
          form.append('selectedAccountNames', JSON.stringify([...item.selections]));
        }

        const result = (await apiClient.post('/import/csv', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120_000,
        })).data;

        setFileItems((prev) =>
          prev.map((i) => i.id === item.id ? { ...i, status: 'done', result } : i)
        );
      } catch (err) {
        const msg = err?.response?.data?.error || 'Import failed — please try again.';
        setFileItems((prev) =>
          prev.map((i) => i.id === item.id ? { ...i, status: 'import_error', error: msg } : i)
        );
      }
    }

    // Refresh all relevant queries once after all imports finish
    queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    queryClient.invalidateQueries({ queryKey: ['import-history'] });
    queryClient.invalidateQueries({ queryKey: ['performance'] });

    setProcessing(false);
  }

  // ── Per-item helpers ──────────────────────────────────────────────────────
  function toggleSelection(itemId, key) {
    setFileItems((prev) =>
      prev.map((i) => {
        if (i.id !== itemId) return i;
        const next = new Set(i.selections);
        if (next.has(key)) next.delete(key); else next.add(key);
        return { ...i, selections: next };
      })
    );
  }

  function toggleAll(itemId, checked) {
    setFileItems((prev) =>
      prev.map((i) => {
        if (i.id !== itemId || !i.preview) return i;
        const isPDF = i.preview.format === 'fidelity_pdf';
        let next;
        if (isPDF) {
          next = checked ? new Set(i.preview.accounts.map((a) => a.accountNumber)) : new Set();
        } else {
          next = checked
            ? new Set(i.preview.accounts.filter((a) => a.matchedAccount).map((a) => a.csvAccountName))
            : new Set();
        }
        return { ...i, selections: next };
      })
    );
  }

  function removeItem(itemId) {
    setFileItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  function clearAll() {
    setFileItems([]);
  }

  // ── Combined results summary ──────────────────────────────────────────────
  const pdfDone  = doneItems.filter((i) => i.preview?.format === 'fidelity_pdf');
  const csvDone  = doneItems.filter((i) => i.preview?.format !== 'fidelity_pdf');
  const totalSnapshots    = pdfDone.reduce((s, i) => s + (i.result?.snapshotsCreated ?? 0), 0);
  const totalTransactions = csvDone.reduce((s, i) => s + (i.result?.transactionsImported ?? 0), 0);
  const totalCSVSnapshots = csvDone.reduce((s, i) => s + (i.result?.snapshotsCreated ?? 0), 0);
  const showCombinedResult = doneItems.length > 1;

  // ── Parsing progress label ─────────────────────────────────────────────────
  const previewingCount = fileItems.filter((i) => i.status === 'previewing').length;
  const readyCount      = fileItems.filter((i) => ['ready', 'done', 'import_error', 'preview_error', 'importing'].includes(i.status)).length;

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-semibold">Import Data</h2>
        <p className="mt-1 text-sm text-slate-400">
          Import historical portfolio data that predates your brokerage connection.
          Drop multiple statements at once to batch-import.
        </p>
      </div>

      {/* Method cards */}
      <MethodCards />

      {/* Composer NAV history */}
      <ComposerHistorySection />

      {/* Drop zone */}
      <div className="space-y-3">
        <DropZone onFiles={addAndPreview} hasFiles={hasFiles} />

        {/* Parsing progress */}
        {anyPreviewing && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
            Parsing {previewingCount} file{previewingCount === 1 ? '' : 's'}…
            {readyCount > 0 ? ` (${readyCount} of ${fileItems.length} done)` : ''}
          </p>
        )}
      </div>

      {/* File sections */}
      {hasFiles && (
        <div className="space-y-3">
          {fileItems.map((item) => (
            <FileSection
              key={item.id}
              item={item}
              onToggleSelection={toggleSelection}
              onToggleAll={toggleAll}
              onRemove={removeItem}
            />
          ))}

          {/* Combined results banner (when multiple files done) */}
          {showCombinedResult && (
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/15 px-5 py-4">
              <p className="font-semibold text-emerald-300">
                ✓ Imported {doneItems.length} file{doneItems.length === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {totalSnapshots > 0 && `${totalSnapshots} PDF snapshot${totalSnapshots === 1 ? '' : 's'} created`}
                {totalSnapshots > 0 && (totalTransactions > 0 || totalCSVSnapshots > 0) && ' · '}
                {totalTransactions > 0 && `${totalTransactions} transaction${totalTransactions === 1 ? '' : 's'} imported`}
                {totalCSVSnapshots > 0 && ` · ${totalCSVSnapshots} CSV snapshot${totalCSVSnapshots === 1 ? '' : 's'}`}
              </p>
            </div>
          )}

          {/* Import action bar */}
          {readyItems.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {totalReadySelections} account{totalReadySelections === 1 ? '' : 's'} selected
                  {' '}across {readyItems.length} file{readyItems.length === 1 ? '' : 's'}
                </p>
                {totalReadySelections === 0 && (
                  <p className="text-xs text-slate-500">Select at least one account above to import.</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button
                  className="bg-slate-700 hover:bg-slate-600 text-sm"
                  onClick={clearAll}
                  disabled={anyImporting}
                >
                  Clear All
                </Button>
                <Button
                  onClick={importAll}
                  disabled={anyImporting || totalReadySelections === 0}
                >
                  {anyImporting
                    ? 'Importing…'
                    : `Import All Selected`}
                </Button>
              </div>
            </div>
          )}

          {/* After all done — navigation */}
          {!readyItems.length && doneItems.length > 0 && !anyImporting && (
            <div className="flex gap-3">
              <Button onClick={() => navigate('/dashboard')}>View Dashboard →</Button>
              <Button onClick={() => navigate('/performance')} className="bg-slate-700 hover:bg-slate-600">
                View Performance →
              </Button>
              <Button onClick={clearAll} className="bg-slate-700 hover:bg-slate-600">
                Import More Files
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Import history */}
      <ImportHistory />
    </div>
  );
}
