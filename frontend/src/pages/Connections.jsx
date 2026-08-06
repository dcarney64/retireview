import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import apiClient from '../api/client';
import ConnectionCard, { institutionAvatar } from '../components/connections/ConnectionCard';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { ACCOUNT_TYPES, formatCurrency, typeLabel } from '../lib/accountTypes';
import { useAuthStore } from '../store/authStore';

// ─── Shared account modal (create / edit manual accounts) ─────────────────────

const EMPTY_ACCOUNT = { name: '', type: 'brokerage', balance: '', notes: '' };

function AccountModal({ account, onClose, onSaved }) {
  const isEdit = Boolean(account?.id);
  const [form, setForm] = useState(
    isEdit
      ? { name: account.name, type: account.type, balance: String(account.balance), notes: account.notes || '' }
      : EMPTY_ACCOUNT
  );
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, type: form.type, notes: form.notes, balance: Number(form.balance) || 0 };
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
        <h3 className="mb-4 text-lg font-semibold text-white">{isEdit ? 'Edit Account' : 'Add Manual Account'}</h3>
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); setError(''); saveMutation.mutate(); }}
        >
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="conn-acct-name">Name</label>
            <Input id="conn-acct-name" value={form.name} onChange={set('name')} placeholder="e.g. Savings account" required autoFocus />
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="conn-acct-type">Type</label>
            <select
              id="conn-acct-type"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={form.type}
              onChange={set('type')}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="conn-acct-balance">Balance ($)</label>
            <Input id="conn-acct-balance" type="number" step="0.01" value={form.balance} onChange={set('balance')} placeholder="0.00" required />
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400" htmlFor="conn-acct-notes">Notes (optional)</label>
            <Input id="conn-acct-notes" value={form.notes} onChange={set('notes')} placeholder="Optional" />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" className="bg-slate-700 hover:bg-slate-600" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Section 1: SnapTrade Brokerages (admin only) ────────────────────────────

function SnapTradeSection() {
  const queryClient = useQueryClient();
  const [syncMsg, setSyncMsg] = useState(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await apiClient.get('/accounts')).data,
  });

  const statusQuery = useQuery({
    queryKey: ['snaptrade-status'],
    queryFn: async () => (await apiClient.get('/snaptrade/status')).data,
    retry: false,
  });

  const syncMutation = useMutation({
    mutationFn: async () => (await apiClient.post('/snaptrade/sync')).data,
    onSuccess: (summary) => {
      setSyncMsg({ ok: true, text: `Synced: ${summary.updated} updated, ${summary.created} added` });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['snaptrade-status'] });
    },
    onError: (err) => setSyncMsg({ ok: false, text: err?.response?.data?.error || 'Sync failed' }),
  });

  const status = statusQuery.data;
  const snapAccounts = (accountsQuery.data || []).filter((a) => a.source === 'snaptrade');

  if (statusQuery.isLoading || accountsQuery.isLoading) return null;

  if (!status?.configured) {
    return (
      <section className="space-y-3">
        <SectionHeader title="Brokerage Accounts" subtitle="Via SnapTrade" />
        <Card>
          <p className="text-sm text-slate-400">
            SnapTrade is not configured. Set{' '}
            <code className="text-slate-300">SNAPTRADE_CLIENT_ID</code> and{' '}
            <code className="text-slate-300">SNAPTRADE_CONSUMER_KEY</code> in{' '}
            <code className="text-slate-300">.env</code>, then restart the backend.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Brokerage Accounts"
        subtitle={`${snapAccounts.length} account${snapAccounts.length === 1 ? '' : 's'} via SnapTrade`}
      >
        <Button className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
          onClick={() => window.open(status.dashboardUrl, '_blank', 'noopener')}>
          + Connect via SnapTrade
        </Button>
        <Button className="text-xs px-3 py-1.5"
          onClick={() => { setSyncMsg(null); syncMutation.mutate(); }}
          disabled={syncMutation.isPending}>
          {syncMutation.isPending ? 'Syncing…' : 'Sync All'}
        </Button>
      </SectionHeader>

      {syncMsg ? (
        <p className={`text-sm ${syncMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{syncMsg.text}</p>
      ) : null}

      {snapAccounts.length === 0 ? (
        <Card>
          <p className="py-4 text-center text-sm text-slate-400">
            No brokerages connected yet — use <strong className="text-slate-300">Connect via SnapTrade</strong> to link one.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {snapAccounts.map((account) => {
            const { letter, color } = institutionAvatar(account.institution, account.name);
            return (
              <ConnectionCard
                key={account.id}
                broker={account.name}
                badge="SnapTrade"
                badgeColor="bg-cyan-500/15 text-cyan-300"
                avatar={letter}
                avatarColor={color}
                balance={account.balance}
                syncedAt={account.last_synced_at}
                connected
              >
                {account.institution ? (
                  <p className="text-xs text-slate-500">{account.institution}</p>
                ) : null}
              </ConnectionCard>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Section 2: Composer Direct API ──────────────────────────────────────────

const EMPTY_KEYS = { keyId: '', keySecret: '' };

function ComposerSection() {
  const queryClient = useQueryClient();
  const [form, setForm]           = useState(EMPTY_KEYS);
  const [showSecret, setShowSecret] = useState(false);
  const [editMode, setEditMode]   = useState(false); // "Edit Keys" expansion
  const [statusMsg, setStatusMsg] = useState(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const composerQuery = useQuery({
    queryKey: ['composer-status'],
    queryFn: async () => (await apiClient.get('/connections/composer')).data,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      (await apiClient.post('/connections/composer', { keyId: form.keyId, keySecret: form.keySecret })).data,
    onSuccess: () => {
      setStatusMsg({ ok: true, text: 'Credentials saved.' });
      setForm(EMPTY_KEYS);
      setEditMode(false);
      queryClient.invalidateQueries({ queryKey: ['composer-status'] });
    },
    onError: (err) => setStatusMsg({ ok: false, text: err?.response?.data?.error || 'Failed to save' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => (await apiClient.delete('/connections/composer')).data,
    onSuccess: () => {
      setStatusMsg(null);
      setEditMode(false);
      setConfirmDisconnect(false);
      queryClient.invalidateQueries({ queryKey: ['composer-status'] });
    },
    onError: (err) => setStatusMsg({ ok: false, text: err?.response?.data?.error || 'Failed to disconnect' }),
  });

  const testMutation = useMutation({
    mutationFn: async (body) => (await apiClient.post('/connections/composer/test', body || {})).data,
    onSuccess: (data) => {
      if (data.success) {
        setStatusMsg({ ok: true, text: `✓ Connected — ${data.accountCount} account${data.accountCount === 1 ? '' : 's'} found` });
      } else {
        setStatusMsg({ ok: false, text: `✗ ${data.error || 'Connection failed'}` });
      }
    },
    onError: (err) => setStatusMsg({ ok: false, text: err?.response?.data?.error || 'Test failed' }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => (await apiClient.post('/connections/composer/sync')).data,
    onSuccess: (data) => {
      setStatusMsg({ ok: true, text: `Synced — ${data.accountsUpdated} account${data.accountsUpdated === 1 ? '' : 's'} updated` });
      queryClient.invalidateQueries({ queryKey: ['composer-status'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    },
    onError: (err) => setStatusMsg({ ok: false, text: err?.response?.data?.error || 'Sync failed' }),
  });

  const isBusy = saveMutation.isPending || testMutation.isPending || syncMutation.isPending || deleteMutation.isPending;
  const cred   = composerQuery.data;

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // ── Connected state ─────────────────────────────────────────────────────────
  if (cred?.configured) {
    return (
      <section className="space-y-3">
        <SectionHeader title="Composer" subtitle="Direct API" />

        <ConnectionCard
          broker="Composer"
          badge="Direct API"
          badgeColor="bg-emerald-500/15 text-emerald-300"
          avatar="C"
          avatarColor="bg-emerald-600"
          balance={cred.balance}
          syncedAt={cred.syncedAt}
          connected
        >
          {/* Key info */}
          {!editMode ? (
            <>
              <div className="mb-3 space-y-1 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="w-20 text-slate-500">Key ID</span>
                  <span className="font-mono text-slate-300">{cred.keyIdMasked}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-20 text-slate-500">Secret</span>
                  <span className="font-mono tracking-widest text-slate-500">••••••••••••••••</span>
                </div>
              </div>

              {statusMsg ? (
                <p className={`mb-3 text-sm ${statusMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{statusMsg.text}</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
                  onClick={() => { setStatusMsg(null); testMutation.mutate({}); }}
                  disabled={isBusy}>
                  {testMutation.isPending ? 'Testing…' : 'Test'}
                </Button>
                <Button className="text-xs px-3 py-1.5"
                  onClick={() => { setStatusMsg(null); syncMutation.mutate(); }}
                  disabled={isBusy}>
                  {syncMutation.isPending ? 'Syncing…' : 'Sync Now'}
                </Button>
                <Button className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
                  onClick={() => { setEditMode(true); setStatusMsg(null); }}
                  disabled={isBusy}>
                  Edit Keys
                </Button>
                <Button className="bg-red-900 hover:bg-red-800 text-xs px-3 py-1.5"
                  onClick={() => setConfirmDisconnect(true)}
                  disabled={isBusy}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            /* Edit Keys inline form */
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); setStatusMsg(null); saveMutation.mutate(); }}
            >
              <p className="text-xs text-slate-400">Enter new credentials to replace the existing ones.</p>
              <div className="space-y-1">
                <label className="block text-xs text-slate-400" htmlFor="comp-edit-keyid">New Key ID</label>
                <Input id="comp-edit-keyid" value={form.keyId} onChange={set('keyId')} placeholder="key_id" required autoFocus className="text-xs" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-slate-400" htmlFor="comp-edit-secret">New Secret</label>
                <div className="relative">
                  <Input
                    id="comp-edit-secret"
                    type={showSecret ? 'text' : 'password'}
                    value={form.keySecret}
                    onChange={set('keySecret')}
                    placeholder="key_secret"
                    required
                    className="pr-16 text-xs"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                    onClick={() => setShowSecret((v) => !v)}
                  >
                    {showSecret ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {statusMsg ? (
                <p className={`text-sm ${statusMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{statusMsg.text}</p>
              ) : null}

              <div className="flex gap-2">
                <Button type="submit" className="text-xs px-3 py-1.5" disabled={isBusy}>
                  {saveMutation.isPending ? 'Saving…' : 'Save Keys'}
                </Button>
                <Button type="button" className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
                  onClick={() => { setEditMode(false); setForm(EMPTY_KEYS); setStatusMsg(null); }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </ConnectionCard>

        <ConfirmDialog
          isOpen={confirmDisconnect}
          title="Disconnect Composer?"
          message="Your Composer API credentials will be removed. Synced accounts will remain but won't update automatically until you reconnect."
          confirmLabel="Disconnect"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDisconnect(false)}
        />
      </section>
    );
  }

  // ── Disconnected state ──────────────────────────────────────────────────────
  return (
    <section className="space-y-3">
      <SectionHeader title="Composer" subtitle="Direct API" />

      <ConnectionCard
        broker="Composer"
        badge="Direct API"
        badgeColor="bg-emerald-500/15 text-emerald-300"
        avatar="C"
        avatarColor="bg-emerald-600"
        connected={false}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); setStatusMsg(null); saveMutation.mutate(); }}
        >
          <div className="space-y-1">
            <label className="block text-xs text-slate-400" htmlFor="comp-keyid">Key ID</label>
            <Input id="comp-keyid" value={form.keyId} onChange={set('keyId')} placeholder="your_key_id" required className="text-xs" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-400" htmlFor="comp-secret">Key Secret</label>
            <div className="relative">
              <Input
                id="comp-secret"
                type={showSecret ? 'text' : 'password'}
                value={form.keySecret}
                onChange={set('keySecret')}
                placeholder="your_key_secret"
                required
                className="pr-16 text-xs"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {statusMsg ? (
            <p className={`text-sm ${statusMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{statusMsg.text}</p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
              disabled={isBusy || !form.keyId || !form.keySecret}
              onClick={() => {
                setStatusMsg(null);
                testMutation.mutate({ keyId: form.keyId, keySecret: form.keySecret });
              }}
            >
              {testMutation.isPending ? 'Testing…' : 'Test Connection'}
            </Button>
            <Button type="submit" className="text-xs px-3 py-1.5" disabled={isBusy}>
              {saveMutation.isPending ? 'Saving…' : 'Save & Connect'}
            </Button>
          </div>
        </form>
      </ConnectionCard>
    </section>
  );
}

// ─── Tracking toggle ──────────────────────────────────────────────────────────

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
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  );
}

// ─── Section 3: Manual Accounts ───────────────────────────────────────────────

function ManualSection() {
  const queryClient  = useQueryClient();
  const [modalAccount, setModalAccount] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

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

  const manualAccounts = (accountsQuery.data || []).filter((a) => a.source === 'manual');

  return (
    <section className="space-y-3">
      <SectionHeader title="Manual Accounts" subtitle={`${manualAccounts.length} account${manualAccounts.length === 1 ? '' : 's'}`}>
        <Button className="text-xs px-3 py-1.5" onClick={() => setModalAccount({})}>
          + Add Manual Account
        </Button>
      </SectionHeader>

      {manualAccounts.length === 0 ? (
        <Card>
          <p className="py-4 text-center text-sm text-slate-400">
            No manual accounts yet. Add pension, real estate, or any account not connected above.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {manualAccounts.map((account) => {
            const { letter, color } = institutionAvatar(account.institution, account.name);
            const excluded = account.include_in_tracking === false;
            return (
              <ConnectionCard
                key={account.id}
                broker={account.name}
                badge={typeLabel(account.type)}
                badgeColor="bg-slate-700/60 text-slate-400"
                avatar={letter}
                avatarColor={color}
                balance={account.balance}
                syncedAt={account.updated_at}
                connected
              >
                <div className="mb-3 flex items-center gap-2">
                  <TrackingToggle
                    checked={!excluded}
                    disabled={toggleTrackingMutation.isPending}
                    onChange={() => toggleTrackingMutation.mutate({ id: account.id, include: excluded })}
                  />
                  <span className={`text-xs ${excluded ? 'text-slate-500' : 'text-slate-400'}`}>
                    {excluded ? 'Excluded from net worth' : 'Included in net worth'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5"
                    onClick={() => setModalAccount(account)}>
                    Edit
                  </Button>
                  <Button className="bg-red-900 hover:bg-red-800 text-xs px-3 py-1.5"
                    onClick={() => setDeleteTarget(account)}>
                    Delete
                  </Button>
                </div>
              </ConnectionCard>
            );
          })}
        </div>
      )}

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

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete account"
        message={`Delete "${deleteTarget?.name}"? Its balance will no longer count toward your net worth.`}
        confirmLabel="Delete"
        onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
        {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Connections() {
  const user = useAuthStore((state) => state.user);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">Connections</h2>
        <p className="text-sm text-slate-400">
          Manage brokerage integrations and manual accounts.
        </p>
      </div>

      {/* Section 1: SnapTrade — admin only */}
      {user?.role === 'admin' ? <SnapTradeSection /> : null}

      {/* Section 2: Composer Direct API */}
      <ComposerSection />

      {/* Section 3: Manual accounts */}
      <ManualSection />
    </div>
  );
}
