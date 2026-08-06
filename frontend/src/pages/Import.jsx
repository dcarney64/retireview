import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import apiClient from '../api/client';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepNumber({ n, active, done }) {
  return (
    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
      done  ? 'bg-emerald-600 text-white' :
      active ? 'bg-sky-500 text-white' :
               'bg-slate-700 text-slate-400'
    }`}>
      {done ? '✓' : n}
    </div>
  );
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile, file }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleFile(f) {
    if (f && f.name.toLowerCase().endsWith('.csv')) onFile(f);
  }

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors cursor-pointer ${
        dragging
          ? 'border-sky-400 bg-sky-500/10'
          : file
          ? 'border-emerald-600 bg-emerald-900/10'
          : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/40'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files[0])}
      />
      {file ? (
        <>
          <div className="text-2xl">📄</div>
          <p className="font-medium text-emerald-400">{file.name}</p>
          <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB · Click to change</p>
        </>
      ) : (
        <>
          <div className="text-3xl text-slate-500">↑</div>
          <p className="text-sm text-slate-300">Drag & drop your CSV here, or click to browse</p>
          <p className="text-xs text-slate-500">.csv files only · max 5 MB</p>
        </>
      )}
    </div>
  );
}

// ─── Account review table ─────────────────────────────────────────────────────

function ReviewTable({ preview, selections, onToggle, onToggleAll }) {
  const matchedAccounts = preview.accounts.filter((a) => a.matchedAccount);
  const allChecked      = matchedAccounts.length > 0
    && matchedAccounts.every((a) => selections.has(a.csvAccountName));
  const someChecked = matchedAccounts.some((a) => selections.has(a.csvAccountName));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-slate-100">
          Accounts found in <span className="text-slate-400">{preview.filename}</span>
        </h4>
        <p className="text-sm text-slate-400">
          {preview.totalTransactions} transaction{preview.totalTransactions === 1 ? '' : 's'} total
        </p>
      </div>

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
                  aria-label="Select all accounts"
                />
              </th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Account</th>
              <th className="px-3 py-2 text-left text-slate-400 font-medium">Number</th>
              <th className="px-3 py-2 text-right text-slate-400 font-medium">Transactions</th>
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
                  <td className="px-3 py-2.5 font-medium text-slate-200">
                    {acct.csvAccountName}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-400">
                    {acct.csvAccountNumber || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">
                    {acct.transactionCount}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-400">
                    {acct.dateRange?.earliest === acct.dateRange?.latest
                      ? fmtDateShort(acct.dateRange?.earliest)
                      : `${fmtDate(acct.dateRange?.earliest)} – ${fmtDate(acct.dateRange?.latest)}`}
                  </td>
                  <td className="px-3 py-2.5">
                    {acct.matchedAccount ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        <span>✓</span>
                        <span className="truncate max-w-[130px]">{acct.matchedAccount.name}</span>
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

      {preview.warnings?.length > 0 ? (
        <div className="space-y-0.5">
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-400">⚠ {w}</p>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        Accounts without a green match badge cannot be imported — add a matching account on the{' '}
        <a href="/accounts" className="underline hover:text-slate-300">Accounts page</a> first.
        Accounts excluded from tracking are pre-unchecked.
      </p>
    </div>
  );
}

// ─── Import history list ──────────────────────────────────────────────────────

function ImportHistory() {
  const queryClient = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);

  const historyQuery = useQuery({
    queryKey: ['import-history'],
    queryFn: async () => (await apiClient.get('/import/history')).data,
  });

  const clearMutation = useMutation({
    mutationFn: async () => apiClient.delete('/import/history'),
    onSuccess: () => {
      setConfirmClear(false);
      queryClient.invalidateQueries({ queryKey: ['import-history'] });
    },
  });

  const history = historyQuery.data || [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Import History</h3>
        {history.length > 0 ? (
          <Button
            className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
            onClick={() => setConfirmClear(true)}
          >
            Clear History
          </Button>
        ) : null}
      </div>

      {historyQuery.isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-slate-800" />
      ) : history.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">No imports yet.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {history.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-200">{item.filename || 'CSV file'}</p>
                  <p className="text-xs text-slate-400">
                    {item.transactions_imported} transaction{item.transactions_imported === 1 ? '' : 's'}
                    {item.snapshots_created > 0 ? ` · ${item.snapshots_created} snapshot${item.snapshots_created === 1 ? '' : 's'}` : ''}
                    {item.date_earliest ? ` · ${fmtDate(item.date_earliest)}` : ''}
                    {item.date_latest && item.date_latest !== item.date_earliest ? ` – ${fmtDate(item.date_latest)}` : ''}
                  </p>
                  {item.accounts_unmatched > 0 ? (
                    <p className="mt-0.5 text-xs text-amber-400">
                      {item.accounts_unmatched} unmatched account{item.accounts_unmatched === 1 ? '' : 's'}
                    </p>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">
                  {new Date(item.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </p>
              </div>
              {item.warnings?.length > 0 ? (
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
              ) : null}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmClear}
        title="Clear import history?"
        message="This removes the import log entries only — your imported transactions and snapshots are kept."
        confirmLabel="Clear History"
        confirmStyle="warning"
        onConfirm={() => clearMutation.mutate()}
        onCancel={() => setConfirmClear(false)}
      />
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Import() {
  const queryClient = useQueryClient();
  const navigate    = useNavigate();

  const [file, setFile]             = useState(null);
  const [preview, setPreview]       = useState(null);   // server preview response
  const [selections, setSelections] = useState(new Set()); // selected csvAccountNames
  const [result, setResult]         = useState(null);   // import result from API

  // step derived from state
  const step = result ? 'done' : preview ? 'review' : 'upload';

  // ── Preview mutation: upload file → get account summaries, no DB writes ──────
  const previewMutation = useMutation({
    mutationFn: async (f) => {
      const form = new FormData();
      form.append('file', f);
      return (await apiClient.post('/import/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: (data) => {
      setPreview(data);
      // Default: check all accounts that have a match AND are include_in_tracking
      const initial = new Set(
        data.accounts
          .filter((a) => a.matchedAccount && a.matchedAccount.include_in_tracking !== false)
          .map((a) => a.csvAccountName)
      );
      setSelections(initial);
    },
  });

  // ── Import mutation: upload file again with selections ───────────────────────
  const importMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('selectedAccountNames', JSON.stringify([...selections]));
      return (await apiClient.post('/import/csv', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      })).data;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['performance'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['import-history'] });
    },
  });

  function handleFileSelected(f) {
    setFile(f);
    setPreview(null);
    setResult(null);
    setSelections(new Set());
    previewMutation.reset();
    importMutation.reset();
    previewMutation.mutate(f);
  }

  function resetToUpload() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setSelections(new Set());
    previewMutation.reset();
    importMutation.reset();
  }

  function toggleSelection(name) {
    setSelections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function toggleAll(checked) {
    if (!preview) return;
    setSelections(
      checked
        ? new Set(preview.accounts.filter((a) => a.matchedAccount).map((a) => a.csvAccountName))
        : new Set()
    );
  }

  // Count of selections that actually have a match (the ones that will import)
  const selectedCount = preview
    ? [...selections].filter((name) =>
        preview.accounts.find((a) => a.csvAccountName === name)?.matchedAccount
      ).length
    : 0;

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-semibold">Import Data</h2>
        <p className="mt-1 text-sm text-slate-400">
          Import historical portfolio data that predates your brokerage connection.
        </p>
      </div>

      {/* ── Section A: Step-by-step guide ─────────────────────────────────── */}
      <Card className="space-y-6">

        {/* Step 1 */}
        <div className="flex gap-4">
          <StepNumber n={1} active={step === 'upload'} done={step !== 'upload'} />
          <div className="flex-1 space-y-2">
            <h3 className="font-semibold text-slate-100">Download your Fidelity history</h3>
            <p className="text-sm text-slate-400">
              Go to <strong className="text-slate-300">Accounts → History → Download</strong>.
              Select <em>All Accounts</em>, <em>Last 5 Years</em>, and <em>CSV</em> format.
            </p>
            <Button
              className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
              onClick={() => window.open('https://www.fidelity.com', '_blank', 'noopener')}
            >
              Open Fidelity.com →
            </Button>
          </div>
        </div>

        <div className="border-t border-slate-800" />

        {/* Step 2 */}
        <div className="flex gap-4">
          <StepNumber n={2} active={step === 'upload'} done={step !== 'upload'} />
          <div className="flex-1 space-y-3">
            <h3 className="font-semibold text-slate-100">Upload your CSV file</h3>
            <DropZone file={file} onFile={handleFileSelected} />

            {previewMutation.isPending ? (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
                Parsing file…
              </p>
            ) : previewMutation.isError ? (
              <p className="text-sm text-red-400">
                {previewMutation.error?.response?.data?.error || 'Could not parse file — check the format and try again.'}
              </p>
            ) : preview ? (
              <p className="text-sm text-emerald-400">
                ✓ Detected <strong>Fidelity</strong> format ·{' '}
                {preview.accounts.length} account{preview.accounts.length === 1 ? '' : 's'} ·{' '}
                {preview.totalTransactions} transactions
              </p>
            ) : null}
          </div>
        </div>

        <div className="border-t border-slate-800" />

        {/* Step 3 */}
        <div className="flex gap-4">
          <StepNumber n={3} active={step === 'review'} done={step === 'done'} />
          <div className="flex-1 space-y-4">
            <h3 className={`font-semibold ${step !== 'upload' ? 'text-slate-100' : 'text-slate-500'}`}>
              Review accounts and import
            </h3>

            {step === 'upload' && (
              <p className="text-sm text-slate-500">Upload a CSV file above to continue.</p>
            )}

            {step === 'review' && preview && (
              <>
                <ReviewTable
                  preview={preview}
                  selections={selections}
                  onToggle={toggleSelection}
                  onToggleAll={toggleAll}
                />

                {importMutation.isError ? (
                  <p className="text-sm text-red-400">
                    {importMutation.error?.response?.data?.error || 'Import failed — please try again.'}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => importMutation.mutate()}
                    disabled={importMutation.isPending || selectedCount === 0}
                  >
                    {importMutation.isPending
                      ? 'Importing…'
                      : selectedCount === 0
                      ? 'Select accounts above'
                      : `Import ${selectedCount} account${selectedCount === 1 ? '' : 's'}`}
                  </Button>
                  <Button
                    className="bg-slate-700 hover:bg-slate-600"
                    onClick={resetToUpload}
                    disabled={importMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}

            {step === 'done' && (
              <p className="text-sm text-emerald-400">✓ Import complete — see results below.</p>
            )}
          </div>
        </div>

      </Card>

      {/* ── Section B: Import results ──────────────────────────────────────── */}
      {result ? (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Import Results</h3>
          <div className="rounded-xl border border-emerald-700/50 bg-emerald-900/20 p-5 space-y-3">
            <p className="font-semibold text-emerald-300">
              ✓ Imported {result.transactionsImported} transaction{result.transactionsImported === 1 ? '' : 's'}
              {result.dateRange.earliest
                ? ` covering ${fmtDate(result.dateRange.earliest)}${
                    result.dateRange.latest !== result.dateRange.earliest
                      ? ` – ${fmtDate(result.dateRange.latest)}`
                      : ''
                  }`
                : ''}
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                <p className="text-xs text-slate-500">Transactions</p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-100">{result.transactionsImported}</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                <p className="text-xs text-slate-500">Snapshots created</p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-100">{result.snapshotsCreated}</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                <p className="text-xs text-slate-500">Accounts matched</p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-100">{result.accountsMatched}</p>
              </div>
              <div className={`rounded-lg border bg-slate-900 p-3 ${result.accountsUnmatched > 0 ? 'border-amber-700/50' : 'border-slate-700'}`}>
                <p className="text-xs text-slate-500">Unmatched</p>
                <p className={`mt-1 font-mono text-lg font-semibold ${result.accountsUnmatched > 0 ? 'text-amber-400' : 'text-slate-100'}`}>
                  {result.accountsUnmatched}
                </p>
              </div>
            </div>

            {result.warnings?.length > 0 ? (
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-amber-400">Warnings</p>
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-slate-400">• {w}</p>
                ))}
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button onClick={() => navigate('/performance')}>
                View Performance →
              </Button>
              <Button className="bg-slate-700 hover:bg-slate-600" onClick={resetToUpload}>
                Import Another File
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Format note ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
        <strong className="text-slate-300">Supported formats:</strong> Fidelity account-history CSV exports.
        Schwab, Vanguard, and other brokers coming soon.
      </div>

      {/* ── Section C: Import history ──────────────────────────────────────── */}
      <ImportHistory />
    </div>
  );
}
