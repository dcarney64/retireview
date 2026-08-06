import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import apiClient from '../api/client';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { ACCOUNT_TYPES, formatCurrency, typeColor } from '../lib/accountTypes';
import { useAuthStore } from '../store/authStore';

// ─── Inline toggle switch ────────────────────────────────────────────────────

function TrackingToggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? 'Included in tracking — click to exclude' : 'Excluded from tracking — click to include'}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      disabled={disabled}
      title={checked ? 'Included in net worth' : 'Excluded from net worth'}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
        checked ? 'bg-emerald-500' : 'bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// ─── Add Account modal (type-selector flow) ───────────────────────────────────

const ADD_TYPES = [
  { id: 'brokerage', emoji: '🏦', title: 'Brokerage',  sub: 'via SnapTrade'  },
  { id: 'composer',  emoji: '🎼', title: 'Composer',    sub: 'Direct API'     },
  { id: 'tsp',       emoji: '🏛️', title: 'TSP',         sub: 'Manual entry'   },
  { id: 'manual',    emoji: '💰', title: 'Manual',      sub: 'Any account'    },
];

function AddAccountModal({ onClose, onSaved }) {
  const navigate      = useNavigate();
  const queryClient   = useQueryClient();
  const overlayRef    = useRef(null);
  const [step, setStep]   = useState('type');
  // composer sub-states
  const [composerLoading, setComposerLoading] = useState(false);
  const [composerConnected, setComposerConnected] = useState(false);
  const [composerAccounts, setComposerAccounts]   = useState([]);
  const [composerSelected, setComposerSelected]   = useState({});
  const [composerError, setComposerError]         = useState('');
  const [composerSaving, setComposerSaving]       = useState(false);
  // manual sub-form
  const [manualDefaultType, setManualDefaultType] = useState('retirement');
  const [manualForm, setManualForm] = useState({ name: '', type: 'retirement', balance: '', notes: '' });
  const [manualError, setManualError] = useState('');

  const manualMutation = useMutation({
    mutationFn: async () => apiClient.post('/accounts', {
      name:    manualForm.name,
      type:    manualForm.type,
      balance: Number(manualForm.balance) || 0,
      notes:   manualForm.notes,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      onSaved?.();
      onClose();
    },
    onError: (err) => setManualError(err?.response?.data?.error || 'Failed to save account'),
  });

  // Close on backdrop click
  const handleOverlay = (e) => { if (e.target === overlayRef.current) onClose(); };

  // Initiate composer sub-flow
  const handlePickComposer = async () => {
    setStep('composer');
    setComposerLoading(true);
    setComposerError('');
    try {
      const statusRes = await apiClient.get('/connections/composer');
      if (!statusRes.data.configured) {
        setComposerConnected(false);
        setComposerLoading(false);
        return;
      }
      const acctRes = await apiClient.get('/connections/composer/accounts');
      const accts   = acctRes.data.accounts || [];
      setComposerAccounts(accts);
      const defaults = {};
      accts.forEach((a) => { defaults[a.id] = { checked: true, customName: a.name }; });
      setComposerSelected(defaults);
      setComposerConnected(true);
    } catch (err) {
      setComposerError(err?.response?.data?.error || 'Failed to load Composer accounts');
    } finally {
      setComposerLoading(false);
    }
  };

  const handlePickType = (id) => {
    if (id === 'brokerage') { setStep('brokerage'); return; }
    if (id === 'composer')  { handlePickComposer(); return; }
    const defaultType = id === 'tsp' ? 'retirement' : 'other';
    setManualDefaultType(defaultType);
    setManualForm((f) => ({ ...f, type: defaultType }));
    setStep('manual');
  };

  const toggleComposer = (id) =>
    setComposerSelected((prev) => ({ ...prev, [id]: { ...prev[id], checked: !prev[id]?.checked } }));
  const setComposerName = (id, value) =>
    setComposerSelected((prev) => ({ ...prev, [id]: { ...prev[id], customName: value } }));

  const handleAddComposerAccounts = async () => {
    setComposerSaving(true);
    setComposerError('');
    try {
      const toAdd = composerAccounts.filter((a) => composerSelected[a.id]?.checked);
      for (const acct of toAdd) {
        const name = composerSelected[acct.id]?.customName || acct.name;
        await apiClient.post('/accounts', {
          name,
          type:       'composer',
          balance:    acct.value,
          source:     'composer',
          externalId: acct.id,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      onSaved?.();
      onClose();
    } catch (err) {
      setComposerError(err?.response?.data?.error || 'Failed to add accounts');
    } finally {
      setComposerSaving(false);
    }
  };

  const checkedCount = composerAccounts.filter((a) => composerSelected[a.id]?.checked).length;

  const stepTitle = {
    type:      'Add Account',
    brokerage: 'Brokerage Account',
    composer:  'Composer Account',
    manual:    step === 'manual' ? (manualDefaultType === 'retirement' ? 'TSP Account' : 'Manual Account') : '',
  }[step] || 'Add Account';

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlay}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <div className="flex items-center gap-3">
            {step !== 'type' && (
              <button type="button" onClick={() => setStep('type')} className="text-xs text-slate-400 hover:text-slate-200">← Back</button>
            )}
            <h3 className="text-base font-semibold text-white">{stepTitle}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-100 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">

          {/* Step: type selector */}
          {step === 'type' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">What type of account?</p>
              <div className="grid grid-cols-2 gap-3">
                {ADD_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handlePickType(t.id)}
                    className="flex flex-col items-start rounded-lg border border-slate-700 bg-slate-800 p-4 text-left transition-colors hover:border-sky-600 hover:bg-slate-700"
                  >
                    <span className="mb-1 text-2xl">{t.emoji}</span>
                    <span className="font-semibold text-slate-100">{t.title}</span>
                    <span className="text-xs text-slate-400">{t.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: brokerage (redirect) */}
          {step === 'brokerage' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Fidelity, Schwab, Alpaca and others connect via SnapTrade. Manage connections in
                Broker Settings.
              </p>
              <Button onClick={() => { onClose(); navigate('/broker-settings'); }}>
                Go to Broker Settings →
              </Button>
            </div>
          )}

          {/* Step: composer */}
          {step === 'composer' && (
            <div className="space-y-4">
              {composerLoading && <p className="text-sm text-slate-500">Checking Composer connection…</p>}
              {composerError  && <p className="text-sm text-red-400">{composerError}</p>}

              {!composerLoading && !composerConnected && !composerError && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-300">Connect Composer in Broker Settings first.</p>
                  <Button onClick={() => { onClose(); navigate('/broker-settings'); }}>
                    Go to Broker Settings →
                  </Button>
                </div>
              )}

              {!composerLoading && composerConnected && (
                <div className="space-y-4">
                  <p className="text-sm font-medium text-slate-300">Select your Composer accounts to track:</p>
                  <div className="divide-y divide-slate-700 rounded-lg border border-slate-700 max-h-72 overflow-y-auto">
                    {composerAccounts.map((acct) => {
                      const sel = composerSelected[acct.id] ?? { checked: false };
                      return (
                        <div key={acct.id} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              id={`c-${acct.id}`}
                              checked={!!sel.checked}
                              onChange={() => toggleComposer(acct.id)}
                              className="h-4 w-4 accent-sky-500"
                            />
                            <label htmlFor={`c-${acct.id}`} className="flex-1 text-sm text-slate-200">{acct.name}</label>
                            <span className="text-sm text-slate-400">{formatCurrency(acct.value)}</span>
                          </div>
                          {sel.checked && (
                            <div className="mt-2 ml-7">
                              <Input
                                value={sel.customName ?? acct.name}
                                onChange={(e) => setComposerName(acct.id, e.target.value)}
                                placeholder="Custom name"
                                className="text-xs py-1.5"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <Button onClick={handleAddComposerAccounts} disabled={composerSaving || checkedCount === 0}>
                    {composerSaving ? 'Adding…' : `Add ${checkedCount} Account${checkedCount !== 1 ? 's' : ''}`}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step: manual entry (TSP or free-form) */}
          {step === 'manual' && (
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); setManualError(''); manualMutation.mutate(); }}
            >
              <div className="space-y-1">
                <label className="block text-sm text-slate-400" htmlFor="add-name">Account name</label>
                <Input
                  id="add-name"
                  value={manualForm.name}
                  onChange={(e) => setManualForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={manualDefaultType === 'retirement' ? 'e.g. TSP Traditional' : 'e.g. Savings account'}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm text-slate-400" htmlFor="add-type">Type</label>
                <select
                  id="add-type"
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  value={manualForm.type}
                  onChange={(e) => setManualForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-sm text-slate-400" htmlFor="add-balance">Balance ($)</label>
                <Input
                  id="add-balance"
                  type="number"
                  step="0.01"
                  value={manualForm.balance}
                  onChange={(e) => setManualForm((f) => ({ ...f, balance: e.target.value }))}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm text-slate-400" htmlFor="add-notes">Notes (optional)</label>
                <Input
                  id="add-notes"
                  value={manualForm.notes}
                  onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              {manualError ? <p className="text-sm text-red-400">{manualError}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" className="bg-slate-700 hover:bg-slate-600" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={manualMutation.isPending}>
                  {manualMutation.isPending ? 'Saving…' : 'Add Account'}
                </Button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}

// SnapTrade runs in personal-API-key mode: brokerage connections are added
// and repaired in the SnapTrade Dashboard (external), while this panel shows
// connection status and pulls fresh balances. Admin-only — the key belongs
// to the app owner.
function SnapTradePanel() {
  const queryClient = useQueryClient();
  const [syncResult, setSyncResult] = useState(null);

  const statusQuery = useQuery({
    queryKey: ['snaptrade-status'],
    queryFn: async () => (await apiClient.get('/snaptrade/status')).data,
    retry: false,
  });

  const syncMutation = useMutation({
    mutationFn: async () => (await apiClient.post('/snaptrade/sync')).data,
    onSuccess: (summary) => {
      setSyncResult({ ok: true, summary });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['snaptrade-status'] });
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      queryClient.invalidateQueries({ queryKey: ['performance'] });
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    },
    onError: (err) => setSyncResult({ ok: false, error: err?.response?.data?.error || 'Sync failed' }),
  });

  const status = statusQuery.data;

  if (statusQuery.isLoading) return null;

  if (statusQuery.isError) {
    return (
      <Card>
        <h3 className="mb-1 font-semibold">Brokerage Sync</h3>
        <p className="text-sm text-red-400">
          {statusQuery.error?.response?.data?.error || 'Could not reach SnapTrade'}
        </p>
      </Card>
    );
  }

  if (!status?.configured) {
    return (
      <Card>
        <h3 className="mb-1 font-semibold">Brokerage Sync</h3>
        <p className="text-sm text-slate-400">
          SnapTrade is not configured. Set <code className="text-slate-300">SNAPTRADE_CLIENT_ID</code> and{' '}
          <code className="text-slate-300">SNAPTRADE_CONSUMER_KEY</code> in <code className="text-slate-300">.env</code>,
          then restart the backend.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Brokerage Sync</h3>
          <p className="text-sm text-slate-400">
            {status.connections.length} connection{status.connections.length === 1 ? '' : 's'} ·{' '}
            {status.linkedAccounts} synced account{status.linkedAccounts === 1 ? '' : 's'}
            {status.lastSyncedAt ? ` · last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            className="bg-slate-700 hover:bg-slate-600"
            onClick={() => window.open(status.dashboardUrl, '_blank', 'noopener')}
          >
            Connect Brokerage
          </Button>
          <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? 'Syncing...' : 'Sync Balances'}
          </Button>
        </div>
      </div>

      {status.connections.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {status.connections.map((connection) => (
            <li key={connection.id} className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${connection.disabled ? 'bg-red-500' : 'bg-emerald-500'}`} />
              <span className="text-slate-300">{connection.brokerage}</span>
              {connection.disabled ? (
                <span className="text-xs text-red-400">disabled — repair in the SnapTrade Dashboard</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-400">
          No brokerages connected yet — use Connect Brokerage to link one in the SnapTrade Dashboard,
          then Sync Balances.
        </p>
      )}

      {syncResult ? (
        syncResult.ok ? (
          <div className="mt-3 text-sm">
            <p className="text-emerald-400">
              Synced: {syncResult.summary.updated} updated, {syncResult.summary.created} added
              {syncResult.summary.txInserted > 0 ? ` · ${syncResult.summary.txInserted} new transaction${syncResult.summary.txInserted === 1 ? '' : 's'}` : ''}
              {syncResult.summary.transfersCreated > 0 ? ` · ${syncResult.summary.transfersCreated} transfer${syncResult.summary.transfersCreated === 1 ? '' : 's'} auto-logged` : ''}
              {syncResult.summary.failures.length ? `, ${syncResult.summary.failures.length} failed` : ''}
            </p>
            {syncResult.summary.failures.map((failure) => (
              <p key={failure.externalId || failure.name} className="text-red-400">
                {failure.name}: {failure.error}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-red-400">{syncResult.error}</p>
        )
      ) : null}
    </Card>
  );
}

// ─── Transfer modal ───────────────────────────────────────────────────────────

const TRANSFER_TYPES = [
  { value: 'deposit',      label: 'Deposit',      hint: 'Added money to this account'      },
  { value: 'withdrawal',   label: 'Withdrawal',   hint: 'Withdrew money from this account' },
  { value: 'transfer_in',  label: 'Transfer In',  hint: 'Moved money into this account'    },
  { value: 'transfer_out', label: 'Transfer Out', hint: 'Moved money out of this account'  },
];

const EMPTY_TRANSFER = { accountId: '', amount: '', transferType: 'deposit', transferredAt: '', notes: '' };

function TransferModal({ accounts, onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_TRANSFER, accountId: accounts[0]?.id || '' });
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiClient.post('/transfers', {
        accountId:     form.accountId,
        amount:        Number(form.amount),
        transferType:  form.transferType,
        transferredAt: form.transferredAt,
        notes:         form.notes,
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save transfer'),
  });

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const selectedType = TRANSFER_TYPES.find((t) => t.value === form.transferType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold text-white">Log Transfer</h3>
        <p className="mb-4 text-xs text-slate-400">
          Recording cash flows lets RetireView compute accurate time-weighted returns (TWR).
        </p>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(''); saveMutation.mutate(); }}>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="transfer-account">Account</label>
            <select
              id="transfer-account"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={form.accountId}
              onChange={set('accountId')}
              required
            >
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="transfer-type">Type</label>
            <select
              id="transfer-type"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={form.transferType}
              onChange={set('transferType')}
            >
              {TRANSFER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {selectedType ? <p className="text-xs text-slate-500">{selectedType.hint}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="transfer-amount">Amount ($)</label>
            <Input id="transfer-amount" type="number" step="0.01" min="0.01" value={form.amount} onChange={set('amount')} placeholder="0.00" required autoFocus />
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="transfer-date">Date</label>
            <Input id="transfer-date" type="date" value={form.transferredAt} onChange={set('transferredAt')} required />
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="transfer-notes">Notes (optional)</label>
            <Input id="transfer-notes" value={form.notes} onChange={set('notes')} placeholder="e.g. Annual contribution" />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" className="bg-slate-700 hover:bg-slate-600" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save Transfer'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Account modal (create / edit) ───────────────────────────────────────────

const EMPTY_FORM = { name: '', type: 'brokerage', balance: '', notes: '' };

function AccountModal({ account, onClose, onSaved }) {
  const isEdit   = Boolean(account?.id);
  const isSynced = account?.source === 'snaptrade';
  const [form, setForm] = useState(
    isEdit
      ? { name: account.name, type: account.type, balance: String(account.balance), notes: account.notes || '' }
      : EMPTY_FORM
  );
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        type: form.type,
        notes: form.notes,
        ...(isSynced ? {} : { balance: Number(form.balance) || 0 }),
      };
      return isEdit
        ? apiClient.put(`/accounts/${account.id}`, payload)
        : apiClient.post('/accounts', payload);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err?.response?.data?.error || 'Failed to save account'),
  });

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold text-white">{isEdit ? 'Edit Account' : 'Add Account'}</h3>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(''); saveMutation.mutate(); }}>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="account-name">Name</label>
            <Input id="account-name" value={form.name} onChange={set('name')} placeholder="e.g. Fidelity brokerage" required autoFocus />
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="account-type">Type</label>
            <select
              id="account-type"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={form.type}
              onChange={set('type')}
            >
              {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="account-balance">Balance ($)</label>
            <Input
              id="account-balance"
              type="number"
              step="0.01"
              value={form.balance}
              onChange={set('balance')}
              placeholder="0.00"
              required={!isSynced}
              disabled={isSynced}
              className={isSynced ? 'opacity-60' : ''}
            />
            {isSynced ? <p className="text-xs text-slate-500">Balance is synced from SnapTrade and can't be edited.</p> : null}
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="account-notes">Notes</label>
            <Input id="account-notes" value={form.notes} onChange={set('notes')} placeholder="Optional" />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" className="bg-slate-700 hover:bg-slate-600" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Accounts() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [addOpen, setAddOpen]           = useState(false);
  const [modalAccount, setModalAccount] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await apiClient.get('/accounts')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/accounts/${id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const toggleTrackingMutation = useMutation({
    mutationFn: async ({ id, include }) =>
      apiClient.put(`/accounts/${id}`, { include_in_tracking: include }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const accounts = accountsQuery.data || [];

  const groups = useMemo(
    () => ACCOUNT_TYPES
      .map((t) => ({ ...t, accounts: accounts.filter((a) => a.type === t.value) }))
      .filter((g) => g.accounts.length > 0),
    [accounts]
  );

  const trackedTotal = useMemo(
    () => accounts.filter((a) => a.include_in_tracking !== false).reduce((sum, a) => sum + Number(a.balance), 0),
    [accounts]
  );
  const excludedCount = accounts.filter((a) => a.include_in_tracking === false).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Accounts</h2>
          <p className="text-sm text-slate-400">
            Total: {formatCurrency(trackedTotal)}
            {excludedCount > 0 ? (
              <span className="ml-2 text-slate-500">
                ({excludedCount} account{excludedCount === 1 ? '' : 's'} excluded from total)
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="bg-slate-700 hover:bg-slate-600" onClick={() => setTransferOpen(true)} disabled={accounts.length === 0}>
            Log Transfer
          </Button>
          <Button onClick={() => setAddOpen(true)}>Add Account</Button>
        </div>
      </div>

      {user?.role === 'admin' ? <SnapTradePanel /> : null}

      {groups.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-400">
            No accounts yet. Add your brokerage, retirement, bank, and property accounts to start tracking.
          </p>
        </Card>
      ) : (
        groups.map((group) => {
          const subtotal = group.accounts
            .filter((a) => a.include_in_tracking !== false)
            .reduce((sum, a) => sum + Number(a.balance), 0);
          return (
            <Card key={group.value}>
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: typeColor(group.value) }} />
                <h3 className="font-semibold">{group.label}</h3>
                <span className="ml-auto text-sm text-slate-400">{formatCurrency(subtotal)}</span>
              </div>
              <div className="space-y-2 text-sm">
                {group.accounts.map((account) => {
                  const excluded = account.include_in_tracking === false;
                  return (
                    <div
                      key={account.id}
                      className={`flex items-center gap-3 rounded-md border border-slate-800 px-3 py-2 transition-opacity ${excluded ? 'opacity-50' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 font-medium text-slate-100">
                          <span className="truncate">{account.name}</span>
                          {account.source === 'snaptrade' ? (
                            <span
                              className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300"
                              title={account.last_synced_at ? `Last synced ${new Date(account.last_synced_at).toLocaleString()}` : 'Synced from SnapTrade'}
                            >
                              Synced
                            </span>
                          ) : null}
                          {excluded ? (
                            <span className="shrink-0 rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                              Excluded
                            </span>
                          ) : null}
                        </div>
                        {account.institution ? (
                          <div className="truncate text-xs text-slate-500">{account.institution}</div>
                        ) : account.notes ? (
                          <div className="truncate text-xs text-slate-500">{account.notes}</div>
                        ) : null}
                      </div>
                      <span className="font-medium text-slate-100">{formatCurrency(account.balance)}</span>

                      {/* Include/exclude toggle */}
                      <TrackingToggle
                        checked={account.include_in_tracking !== false}
                        disabled={toggleTrackingMutation.isPending}
                        onChange={() => toggleTrackingMutation.mutate({
                          id: account.id,
                          include: account.include_in_tracking === false,
                        })}
                      />

                      <Button className="bg-slate-700 px-3 py-1 hover:bg-slate-600" onClick={() => setModalAccount(account)}>
                        Edit
                      </Button>
                      <Button className="bg-red-900 px-3 py-1 hover:bg-red-800" onClick={() => setDeleteTarget(account)}>
                        Delete
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}

      {addOpen ? (
        <AddAccountModal
          onClose={() => setAddOpen(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['accounts'] })}
        />
      ) : null}

      {modalAccount !== null ? (
        <AccountModal
          account={modalAccount}
          onClose={() => setModalAccount(null)}
          onSaved={() => {
            setModalAccount(null);
            queryClient.invalidateQueries({ queryKey: ['accounts'] });
          }}
        />
      ) : null}

      {transferOpen && accounts.length > 0 ? (
        <TransferModal
          accounts={accounts}
          onClose={() => setTransferOpen(false)}
          onSaved={() => {
            setTransferOpen(false);
            queryClient.invalidateQueries({ queryKey: ['transfers'] });
            queryClient.invalidateQueries({ queryKey: ['performance'] });
          }}
        />
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete account"
        message={
          deleteTarget?.source === 'snaptrade'
            ? `Delete "${deleteTarget?.name}"? It is synced from SnapTrade, so the next sync will re-create it unless you disconnect the brokerage first. Past snapshots that include it will lose its detail rows.`
            : `Delete "${deleteTarget?.name}"? Its balance will no longer count toward your net worth. Past snapshots that include it will also lose its detail rows.`
        }
        confirmLabel="Delete"
        onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
