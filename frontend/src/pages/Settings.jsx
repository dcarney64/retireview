import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import apiClient from '../api/client';
import SecuritySection from '../components/settings/SecuritySection';
import PasswordStrengthMeter from '../components/shared/PasswordStrengthMeter';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useProfileStore } from '../store/profileStore';

function ProfileCard() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [saved, setSaved] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['settings-profile'],
    queryFn: async () => (await apiClient.get('/settings')).data,
  });

  useEffect(() => {
    if (profileQuery.data) {
      setFullName(profileQuery.data.full_name || '');
    }
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => apiClient.patch('/settings/profile', { fullName }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ['settings-profile'] });
    },
  });

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Profile</h3>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="profile-email">Email</label>
          <Input
            id="profile-email"
            value={profileQuery.data?.email || ''}
            disabled
            className="opacity-60"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="profile-name">Name</label>
          <Input
            id="profile-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
          {saved ? <span className="text-sm text-emerald-400">Saved</span> : null}
        </div>
      </form>
    </Card>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const changeMutation = useMutation({
    mutationFn: async () => apiClient.patch('/settings/password', { currentPassword, newPassword }),
    onSuccess: () => {
      setSuccess(true);
      setError('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err) => {
      setSuccess(false);
      setError(err?.response?.data?.error || 'Failed to change password');
    },
  });

  const onSubmit = (event) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    changeMutation.mutate();
  };

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Change Password</h3>
      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="current-password">Current password</label>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="new-password">New password</label>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={12}
          />
          <PasswordStrengthMeter password={newPassword} />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-400" htmlFor="confirm-password">Confirm new password</label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-400">Password updated</p> : null}

        <Button type="submit" disabled={changeMutation.isPending}>
          {changeMutation.isPending ? 'Updating...' : 'Update Password'}
        </Button>
      </form>
    </Card>
  );
}

function NotificationsCard() {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState('');

  const profileQuery = useQuery({
    queryKey: ['settings-profile'],
    queryFn: async () => (await apiClient.get('/settings')).data,
  });

  const enabled = profileQuery.data?.email_digest_enabled !== false;
  const frequency = profileQuery.data?.digest_frequency || 'weekly';

  const saveMutation = useMutation({
    mutationFn: async (patch) => apiClient.patch('/settings/notifications', patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings-profile'] }),
  });

  const testMutation = useMutation({
    mutationFn: async () => apiClient.post('/settings/notifications/test'),
    onSuccess: (res) => setTestResult(res.data.logged
      ? 'Digest generated (dev mode — logged to backend console)'
      : 'Test digest sent — check your inbox'),
    onError: (err) => setTestResult(err?.response?.data?.error || 'Failed to send test digest'),
  });

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Notifications</h3>
      <div className="space-y-4">
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saveMutation.isPending || profileQuery.isLoading}
            onChange={(e) => saveMutation.mutate({ email_digest_enabled: e.target.checked })}
          />
          Email digest with net worth, account changes, and retirement outlook
        </label>

        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-400" htmlFor="digest-freq">Frequency</label>
          <select
            id="digest-freq"
            value={frequency}
            disabled={!enabled || saveMutation.isPending}
            onChange={(e) => saveMutation.mutate({ digest_frequency: e.target.value })}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none disabled:opacity-50"
          >
            <option value="weekly">Weekly (Monday 8am)</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <Button
            className="bg-slate-700 hover:bg-slate-600"
            onClick={() => { setTestResult(''); testMutation.mutate(); }}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? 'Sending…' : 'Send test digest'}
          </Button>
          {testResult ? <span className="text-sm text-slate-400">{testResult}</span> : null}
        </div>
      </div>
    </Card>
  );
}

// ─── Preset profile colors ────────────────────────────────────────────────────
const PRESET_COLORS = [
  { value: '#6366f1', label: 'Indigo' },
  { value: '#ec4899', label: 'Pink'   },
  { value: '#10b981', label: 'Emerald'},
  { value: '#f59e0b', label: 'Amber'  },
  { value: '#3b82f6', label: 'Blue'   },
  { value: '#ef4444', label: 'Red'    },
];

const RELATIONSHIPS = [
  { value: 'spouse',    label: 'Spouse'    },
  { value: 'partner',   label: 'Partner'   },
  { value: 'dependent', label: 'Dependent' },
  { value: 'other',     label: 'Other'     },
];

function AddMemberModal({ onClose, onSaved }) {
  const [name, setName]       = useState('');
  const [rel, setRel]         = useState('spouse');
  const [birthYear, setBirthYear] = useState('');
  const [color, setColor]     = useState('#ec4899');
  const [error, setError]     = useState('');

  const createMutation = useMutation({
    mutationFn: async () => apiClient.post('/profiles', {
      name: name.trim(),
      relationship: rel,
      birthYear: birthYear ? Number(birthYear) : null,
      color,
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err) => setError(err?.response?.data?.error || 'Failed to add member'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold">Add Household Member</h3>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); setError(''); createMutation.mutate(); }}
        >
          <div className="space-y-1">
            <label className="block text-sm text-slate-400">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Layla" required />
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400">Relationship</label>
            <select
              value={rel}
              onChange={(e) => setRel(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {RELATIONSHIPS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-slate-400">Birth Year (optional)</label>
            <Input
              type="number"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              placeholder="e.g. 1978"
              min={1920} max={2010}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm text-slate-400">Color</label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => setColor(c.value)}
                  className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    background: c.value,
                    borderColor: color === c.value ? '#fff' : 'transparent',
                  }}
                />
              ))}
            </div>
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={onClose} className="bg-slate-700 hover:bg-slate-600">Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending ? 'Adding...' : 'Add Member'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HouseholdMembersCard() {
  const queryClient = useQueryClient();
  const loadProfiles = useProfileStore((state) => state.loadProfiles);
  const [addOpen, setAddOpen] = useState(false);

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => (await apiClient.get('/profiles')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/profiles/${id}`),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      // Reload the profile store so the TopBar switcher updates
      await loadProfiles();
    },
  });

  const profiles = profilesQuery.data || [];

  const handleDelete = (profile) => {
    if (!window.confirm(
      `Remove ${profile.name}?\n\nAll their accounts, properties, scenarios, and financial data will be permanently deleted.`
    )) return;
    deleteMutation.mutate(profile.id);
  };

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">Household Members</h3>
          <p className="mt-0.5 text-sm text-slate-400">
            Each member has their own accounts, properties, and scenarios. Use the Combined view to see everything together.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="shrink-0">+ Add Member</Button>
      </div>

      {profilesQuery.isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-2">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3"
            >
              {/* Avatar */}
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ background: profile.color }}
              >
                {profile.avatarInitial}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-100">{profile.name}</span>
                  {profile.isPrimary && (
                    <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-400">You</span>
                  )}
                  {!profile.isPrimary && (
                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300 capitalize">
                      {profile.relationship}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: profile.color }}
                  />
                  {PRESET_COLORS.find((c) => c.value === profile.color)?.label || profile.color}
                  {profile.birthYear ? ` · Born ${profile.birthYear}` : ''}
                </div>
              </div>

              {/* Remove button (non-primary only) */}
              {!profile.isPrimary && (
                <button
                  type="button"
                  onClick={() => handleDelete(profile)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <AddMemberModal
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            queryClient.invalidateQueries({ queryKey: ['profiles'] });
            await loadProfiles();
          }}
        />
      )}
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-2xl font-semibold">Settings</h2>
      <ProfileCard />
      <HouseholdMembersCard />
      <NotificationsCard />
      <ChangePasswordCard />
      <SecuritySection />
    </div>
  );
}
