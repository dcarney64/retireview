import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import apiClient from '../../api/client';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
  { label: '30 days', minutes: 43200 },
  { label: 'Permanent', minutes: null },
];

const FILTERS = ['All', 'Failed', 'New IP', 'Blocked'];

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function expiryLabel(row) {
  if (row.is_permanent || !row.expires_at) return 'Permanent';
  const ms = new Date(row.expires_at).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m left`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h left`;
  return `${Math.round(minutes / 1440)}d left`;
}

export default function SecurityDashboard() {
  const queryClient = useQueryClient();

  const [blockForm, setBlockForm] = useState({ ip: '', reason: '', duration: '1440' });
  const [filter, setFilter] = useState('All');
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [error, setError] = useState('');

  const blockedQuery = useQuery({
    queryKey: ['admin-blocked-ips'],
    queryFn: async () => (await apiClient.get('/admin/security/blocked-ips')).data,
  });
  const historyQuery = useQuery({
    queryKey: ['admin-login-history'],
    queryFn: async () => (await apiClient.get('/admin/security/login-history?limit=100')).data,
  });
  const failedQuery = useQuery({
    queryKey: ['admin-failed-attempts'],
    queryFn: async () => (await apiClient.get('/admin/security/failed-attempts')).data,
  });
  const sessionsQuery = useQuery({
    queryKey: ['admin-sessions'],
    queryFn: async () => (await apiClient.get('/admin/security/sessions')).data,
  });

  const invalidateBlocked = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-blocked-ips'] });
    queryClient.invalidateQueries({ queryKey: ['admin-failed-attempts'] });
  };

  const blockMutation = useMutation({
    mutationFn: async ({ ip, reason, minutes }) =>
      apiClient.post('/admin/security/block-ip', {
        ip,
        reason,
        permanent: minutes === null,
        durationMinutes: minutes || undefined,
      }),
    onSuccess: () => {
      setBlockForm({ ip: '', reason: '', duration: '1440' });
      setError('');
      invalidateBlocked();
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to block IP'),
  });

  const unblockMutation = useMutation({
    mutationFn: async (ip) => apiClient.delete(`/admin/security/blocked-ips/${encodeURIComponent(ip)}`),
    onSuccess: invalidateBlocked,
    onError: (err) => setError(err.response?.data?.error || 'Failed to unblock IP'),
  });

  const revokeMutation = useMutation({
    mutationFn: async (userId) => apiClient.post(`/admin/security/revoke-sessions/${userId}`),
    onSuccess: () => {
      setRevokeTarget(null);
      queryClient.invalidateQueries({ queryKey: ['admin-sessions'] });
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to revoke sessions'),
  });

  const blocked = blockedQuery.data || [];
  const history = (historyQuery.data || []).filter((row) => {
    if (filter === 'Failed') return !row.success;
    if (filter === 'New IP') return row.is_new_ip;
    if (filter === 'Blocked') return row.failure_reason === 'ip_blocked';
    return true;
  });
  const failed = failedQuery.data || [];
  const sessions = sessionsQuery.data || [];

  const submitBlock = (e) => {
    e.preventDefault();
    const minutes = blockForm.duration === 'permanent' ? null : Number(blockForm.duration);
    blockMutation.mutate({ ip: blockForm.ip, reason: blockForm.reason, minutes });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Security</h2>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Card className="space-y-4">
        <h3 className="text-lg font-semibold text-white">Blocked IPs</h3>

        <form className="flex flex-wrap items-end gap-3" onSubmit={submitBlock}>
          <label className="text-sm text-slate-300">
            IP address
            <Input
              value={blockForm.ip}
              onChange={(e) => setBlockForm((f) => ({ ...f, ip: e.target.value }))}
              placeholder="203.0.113.7"
              className="mt-1 w-44 border-slate-600 bg-slate-700 text-white"
              required
            />
          </label>
          <label className="text-sm text-slate-300">
            Reason
            <Input
              value={blockForm.reason}
              onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Reason"
              className="mt-1 w-56 border-slate-600 bg-slate-700 text-white"
              required
            />
          </label>
          <label className="text-sm text-slate-300">
            Duration
            <select
              value={blockForm.duration}
              onChange={(e) => setBlockForm((f) => ({ ...f, duration: e.target.value }))}
              className="mt-1 block h-10 rounded-md border border-slate-600 bg-slate-700 px-2 text-sm text-white"
            >
              {DURATIONS.map((d) => (
                <option key={d.label} value={d.minutes === null ? 'permanent' : d.minutes}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" className="bg-red-700 text-white hover:bg-red-600" disabled={blockMutation.isPending}>
            Block
          </Button>
        </form>

        {blocked.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">IP Address</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Blocked</th>
                  <th className="py-2 pr-4">Expires</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {blocked.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800 text-slate-200">
                    <td className="py-2 pr-4 font-mono text-xs">{row.ip_address}</td>
                    <td className="py-2 pr-4 text-xs">{row.reason}</td>
                    <td className="py-2 pr-4 text-xs text-slate-400">{formatDate(row.blocked_at)}</td>
                    <td className="py-2 pr-4 text-xs">{expiryLabel(row)}</td>
                    <td className="py-2 pr-4 text-xs">{row.blocked_by === 'system' ? 'Auto' : 'Manual'}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => unblockMutation.mutate(row.ip_address)}
                        className="text-xs text-sky-400 hover:underline"
                      >
                        Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No blocked IPs.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Recent Login Activity</h3>
          <div className="flex gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1 text-xs ${filter === f
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">IP</th>
                <th className="py-2 pr-4">Location</th>
                <th className="py-2 pr-4">Success</th>
                <th className="py-2 pr-4">2FA</th>
                <th className="py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-800 ${!row.success
                    ? 'bg-red-500/10 text-red-200'
                    : row.is_new_ip
                      ? 'bg-amber-500/10 text-amber-100'
                      : 'text-slate-200'}`}
                >
                  <td className="py-2 pr-4 text-xs">{formatDate(row.created_at)}</td>
                  <td className="py-2 pr-4 text-xs">{row.email || '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{row.ip_address}</td>
                  <td className="py-2 pr-4 text-xs">
                    {[row.city, row.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="py-2 pr-4 text-xs">{row.success ? '✓' : '✗'}</td>
                  <td className="py-2 pr-4 text-xs">{row.two_fa_used ? row.two_fa_method : '—'}</td>
                  <td className="py-2 text-xs">{row.failure_reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.length ? <p className="py-2 text-sm text-slate-400">No matching activity.</p> : null}
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-lg font-semibold text-white">Failed Attempt Hotspots (24h)</h3>
        {failed.length ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">IP Address</th>
                <th className="py-2 pr-4">Attempts</th>
                <th className="py-2 pr-4">Location</th>
                <th className="py-2 pr-4">Last Attempt</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {failed.map((row) => (
                <tr key={row.ip_address} className="border-b border-slate-800 text-slate-200">
                  <td className="py-2 pr-4 font-mono text-xs">{row.ip_address}</td>
                  <td className="py-2 pr-4">{row.attempts}</td>
                  <td className="py-2 pr-4 text-xs">{row.location || '—'}</td>
                  <td className="py-2 pr-4 text-xs text-slate-400">{formatDate(row.last_attempt)}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => blockMutation.mutate({
                        ip: row.ip_address,
                        reason: `Manual block: ${row.attempts} failed attempts in 24h`,
                        minutes: 1440,
                      })}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Block
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">No failed attempts in the last 24 hours.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <h3 className="text-lg font-semibold text-white">Active Sessions</h3>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-xs uppercase text-slate-400">
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Active Sessions</th>
              <th className="py-2 pr-4">Latest Expiry</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((row) => (
              <tr key={row.user_id} className="border-b border-slate-800 text-slate-200">
                <td className="py-2 pr-4 text-xs">{row.full_name || row.email}</td>
                <td className="py-2 pr-4">{row.active_sessions}</td>
                <td className="py-2 pr-4 text-xs text-slate-400">
                  {row.active_sessions ? formatDate(row.latest_expiry) : '—'}
                </td>
                <td className="py-2 text-right">
                  {row.active_sessions ? (
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(row)}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Revoke all sessions
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ConfirmDialog
        isOpen={Boolean(revokeTarget)}
        title="Revoke all sessions?"
        message={`${revokeTarget?.email} will be logged out everywhere within 15 minutes and must log in again.`}
        confirmLabel="Revoke"
        onConfirm={() => revokeMutation.mutate(revokeTarget.user_id)}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
