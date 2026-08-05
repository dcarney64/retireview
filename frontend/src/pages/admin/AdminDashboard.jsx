import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import apiClient from '../../api/client';
import { Card } from '../../components/ui/card';

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function AdminDashboard() {
  const statusQuery = useQuery({
    queryKey: ['admin-status'],
    queryFn: async () => (await apiClient.get('/admin/status')).data,
    refetchInterval: 30000,
  });

  const system = statusQuery.data?.system;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Admin Dashboard</h2>

      <Card>
        <h3 className="mb-4 text-lg font-semibold">System</h3>
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <div className="text-slate-400">Database</div>
            <div className={system?.dbConnected ? 'text-emerald-400' : 'text-red-400'}>
              {system ? (system.dbConnected ? 'Connected' : 'Down') : '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Uptime</div>
            <div>{formatUptime(system?.backendUptime)}</div>
          </div>
          <div>
            <div className="text-slate-400">Node</div>
            <div>{system?.nodeVersion || '—'}</div>
          </div>
          <div>
            <div className="text-slate-400">Environment</div>
            <div>{system?.environment || '—'}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link to="/admin/users">
          <Card className="h-full transition-colors hover:border-sky-500/50">
            <h3 className="mb-1 text-lg font-semibold">User Management</h3>
            <p className="text-sm text-slate-400">Create users, change roles, deactivate accounts.</p>
          </Card>
        </Link>
        <Link to="/admin/security">
          <Card className="h-full transition-colors hover:border-sky-500/50">
            <h3 className="mb-1 text-lg font-semibold">Security</h3>
            <p className="text-sm text-slate-400">Login history, blocked IPs, active sessions.</p>
          </Card>
        </Link>
      </div>

      {/* TODO: add your app's admin widgets here */}
    </div>
  );
}
