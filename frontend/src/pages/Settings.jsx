import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import apiClient from '../api/client';
import SecuritySection from '../components/settings/SecuritySection';
import PasswordStrengthMeter from '../components/shared/PasswordStrengthMeter';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';

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

export default function Settings() {
  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-2xl font-semibold">Settings</h2>
      <ProfileCard />
      <NotificationsCard />
      <ChangePasswordCard />
      <SecuritySection />
    </div>
  );
}
