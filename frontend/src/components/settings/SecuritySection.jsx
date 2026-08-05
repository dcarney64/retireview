import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import apiClient from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import ConfirmDialog from '../shared/ConfirmDialog';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import TOTPSetup from './TOTPSetup';

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

const STATUS_LABELS = {
  used: { text: 'Used ✓', className: 'text-emerald-400' },
  failed: { text: 'Failed', className: 'text-red-400' },
  expired: { text: 'Expired', className: 'text-slate-400' },
  pending: { text: 'Pending', className: 'text-amber-400' },
};

export default function SecuritySection() {
  const queryClient = useQueryClient();
  const logout = useAuthStore((state) => state.logout);

  const [editingId, setEditingId] = useState(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
  const [error, setError] = useState('');

  const trustedIpsQuery = useQuery({
    queryKey: ['trusted-ips'],
    queryFn: async () => (await apiClient.get('/auth/trusted-ips')).data,
  });

  const otpActivityQuery = useQuery({
    queryKey: ['otp-activity'],
    queryFn: async () => (await apiClient.get('/auth/otp-activity')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['trusted-ips'] });

  const updateLabelMutation = useMutation({
    mutationFn: async ({ id, label }) => apiClient.put(`/auth/trusted-ips/${id}`, { label }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to update label'),
  });

  const removeMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/auth/trusted-ips/${id}`),
    onSuccess: () => {
      setConfirmRemove(null);
      invalidate();
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to remove trusted IP'),
  });

  const removeAllMutation = useMutation({
    mutationFn: async () => apiClient.delete('/auth/trusted-ips'),
    onSuccess: async () => {
      setConfirmRemoveAll(false);
      await logout();
      window.location.href = '/login';
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to remove trusted devices'),
  });

  const trustedIps = trustedIpsQuery.data || [];
  const activity = otpActivityQuery.data || [];

  return (
    <Card className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Security</h3>

      <TOTPSetup />

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-slate-300">Trusted Devices</h4>
        <p className="text-xs text-slate-500">
          Logins from these IP addresses skip the email verification code until they expire.
        </p>

        {trustedIpsQuery.isLoading ? <p className="text-sm text-slate-400">Loading…</p> : null}
        {trustedIpsQuery.isError ? (
          <p className="text-sm text-red-400">
            {trustedIpsQuery.error?.response?.data?.error || 'Failed to load trusted devices'}
          </p>
        ) : null}

        {!trustedIpsQuery.isLoading && !trustedIps.length ? (
          <p className="text-sm text-slate-400">
            No trusted devices yet. Devices are added when you verify a login code.
          </p>
        ) : null}

        {trustedIps.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">IP Address</th>
                  <th className="py-2 pr-4">Label</th>
                  <th className="py-2 pr-4">First Seen</th>
                  <th className="py-2 pr-4">Last Seen</th>
                  <th className="py-2 pr-4">Expires</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {trustedIps.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800 text-slate-200">
                    <td className="py-2 pr-4 font-mono text-xs">{row.ip_address}</td>
                    <td className="py-2 pr-4">
                      {editingId === row.id ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            updateLabelMutation.mutate({ id: row.id, label: labelDraft });
                          }}
                        >
                          <Input
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            className="h-8 w-36 border-slate-600 bg-slate-700 text-white"
                            autoFocus
                          />
                          <button type="submit" className="text-xs text-sky-400 hover:underline">
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs text-slate-400 hover:text-slate-200"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        row.label || <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-400">{formatDate(row.first_seen)}</td>
                    <td className="py-2 pr-4 text-xs text-slate-400">{formatDate(row.last_seen)}</td>
                    <td className="py-2 pr-4 text-xs text-slate-400">
                      {row.expires_at ? formatDate(row.expires_at) : 'Never'}
                    </td>
                    <td className="py-2 text-right">
                      {editingId !== row.id ? (
                        <span className="flex justify-end gap-3 text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(row.id);
                              setLabelDraft(row.label || '');
                            }}
                            className="text-sky-400 hover:underline"
                          >
                            Edit label
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemove(row)}
                            className="text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-slate-300">Recent OTP Activity</h4>

        {otpActivityQuery.isLoading ? <p className="text-sm text-slate-400">Loading…</p> : null}
        {!otpActivityQuery.isLoading && !activity.length ? (
          <p className="text-sm text-slate-400">No verification codes sent yet.</p>
        ) : null}

        {activity.length ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">IP</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((row) => {
                const status = STATUS_LABELS[row.status] || STATUS_LABELS.expired;
                return (
                  <tr key={row.id} className="border-b border-slate-800 text-slate-200">
                    <td className="py-2 pr-4 text-xs text-slate-400">{formatDate(row.date)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{row.ip || '—'}</td>
                    <td className={`py-2 text-xs ${status.className}`}>{status.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="border-t border-slate-700 pt-4">
        <Button
          className="bg-red-700 text-white hover:bg-red-600"
          onClick={() => setConfirmRemoveAll(true)}
          disabled={removeAllMutation.isPending}
        >
          Remove All Trusted Devices
        </Button>
        <p className="mt-2 text-xs text-slate-500">
          Logs out all sessions and requires email verification on the next login from every device.
        </p>
      </div>

      <ConfirmDialog
        isOpen={Boolean(confirmRemove)}
        title="Remove trusted device?"
        message={`Logins from ${confirmRemove?.ip_address} will require email verification.`}
        confirmLabel="Remove"
        onConfirm={() => removeMutation.mutate(confirmRemove.id)}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        isOpen={confirmRemoveAll}
        title="Remove all trusted devices?"
        message="All sessions will be logged out (including this one) and every device will require email verification on next login."
        confirmLabel="Remove All"
        onConfirm={() => removeAllMutation.mutate()}
        onCancel={() => setConfirmRemoveAll(false)}
      />
    </Card>
  );
}
