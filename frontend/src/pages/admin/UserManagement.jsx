import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import apiClient from '../../api/client';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'user' });

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const response = await apiClient.get('/admin/users');
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await apiClient.post('/admin/users', payload);
      return response.data;
    },
    onSuccess: () => {
      setShowCreate(false);
      setForm({ fullName: '', email: '', password: '', role: 'user' });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const response = await apiClient.patch(`/admin/users/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => apiClient.delete(`/admin/users/${id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const users = useMemo(() => usersQuery.data || [], [usersQuery.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">User Management</h2>
        <Button onClick={() => setShowCreate(true)}>Create User</Button>
      </div>

      <Card className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last Login</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-slate-800">
                <td className="px-3 py-2">{user.full_name || '-'}</td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">
                  <select
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    value={user.role}
                    onChange={(e) => patchMutation.mutate({
                      id: user.id,
                      payload: { role: e.target.value },
                    })}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-3 py-2">{user.is_active ? 'Active' : 'Inactive'}</td>
                <td className="px-3 py-2">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '-'}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <Button
                      className="bg-slate-700 hover:bg-slate-600"
                      onClick={() => patchMutation.mutate({
                        id: user.id,
                        payload: { is_active: !user.is_active },
                      })}
                    >
                      {user.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      className="bg-red-900 hover:bg-red-800"
                      onClick={() => setDeleteTarget(user)}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showCreate ? (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Create User</h3>
          <form
            className="grid grid-cols-1 gap-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate(form);
            }}
          >
            <Input
              placeholder="Full name"
              value={form.fullName}
              onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
            />
            <Input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              required
            />
            <select
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={form.role}
              onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <div className="col-span-full flex gap-2">
              <Button type="submit">Create</Button>
              <Button type="button" className="bg-slate-700 hover:bg-slate-600" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete user"
        message={`Permanently delete ${deleteTarget?.email}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
