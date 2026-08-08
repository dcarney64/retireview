import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Briefcase,
  Building2,
  LayoutDashboard,
  LineChart,
  Receipt,
  RefreshCw,
  Rocket,
  Target,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import apiClient from '../../api/client';
import { useActiveProfile } from '../../store/useActiveProfile';
import { useAuthStore } from '../../store/authStore';

const mainItems = [
  { label: 'Dashboard',    path: '/',             icon: LayoutDashboard },
  { label: 'Net Worth',    path: '/net-worth',    icon: TrendingUp      },
  { label: 'Performance',  path: '/performance',  icon: LineChart       },
  { label: 'Real Estate',  path: '/real-estate',  icon: Building2       },
  { label: 'Other Assets', path: '/other-assets', icon: Briefcase       },
  { label: 'Accounts',     path: '/accounts',     icon: Wallet          },
  { label: 'Import Data',  path: '/import',       icon: Upload          },
  { label: 'Income',       path: '/income',       icon: RefreshCw       },
  { label: 'Cash Flow',    path: '/cash-flow',    icon: ArrowLeftRight  },
  { label: 'Retirement',   path: '/retirement',   icon: Target          },
  { label: 'Tax Planning', path: '/tax-planning', icon: Receipt         },
];

const adminItems = [
  { label: 'Admin Dashboard', path: '/admin'         },
  { label: 'User Management', path: '/admin/users'   },
  { label: 'Security',        path: '/admin/security'},
];

function isActivePath(pathname, itemPath) {
  if (itemPath === '/') {
    return pathname === '/';
  }
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

// Badge shown next to Getting Started in the sidebar
function SetupBadge({ status }) {
  if (!status) return null;
  const { overallPct, isMinimumComplete } = status;
  if (overallPct >= 100) return null;

  if (isMinimumComplete) {
    return (
      <span className="ml-auto rounded-full border border-emerald-700 bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
        ✓
      </span>
    );
  }

  return (
    <span className="ml-auto rounded-full border border-amber-700 bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
      {overallPct}%
    </span>
  );
}

export default function Sidebar() {
  const location = useLocation();
  const user     = useAuthStore((state) => state.user);
  const pid      = useActiveProfile();

  // Fetch setup status for the sidebar badge.
  // Shares the same query key as the Getting Started page — no extra network call.
  const { data: setupStatus } = useQuery({
    queryKey:  ['setup-status', pid],
    queryFn:   async () => (await apiClient.get('/setup/status')).data,
    staleTime: 60_000,
    retry:     false,
  });

  const renderLink = (item) => {
    const active = isActivePath(location.pathname, item.path);
    const Icon = item.icon;
    return (
      <Link
        key={item.path}
        to={item.path}
        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
          active ? 'bg-sky-500/20 text-sky-300' : 'text-slate-300 hover:bg-slate-800'
        }`}
      >
        {Icon ? <Icon size={16} className="shrink-0" /> : null}
        {item.label}
      </Link>
    );
  };

  const gsActive = isActivePath(location.pathname, '/getting-started');

  return (
    <aside className="w-72 shrink-0 border-r border-slate-800 bg-slate-900 p-4">
      <nav className="space-y-1">
        {/* Getting Started — always pinned at top with live badge */}
        <Link
          to="/getting-started"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
            gsActive ? 'bg-sky-500/20 text-sky-300' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Rocket size={16} className="shrink-0" />
          Getting Started
          <SetupBadge status={setupStatus} />
        </Link>

        <div className="my-1 h-px bg-slate-800" />

        {mainItems.map(renderLink)}
      </nav>

      {user?.role === 'admin' ? (
        <div className="mt-6 border-t border-slate-800 pt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Admin</div>
          <nav className="space-y-1">
            {adminItems.map((item) => {
              const active = isActivePath(location.pathname, item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    active ? 'bg-amber-500/20 text-amber-300' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </aside>
  );
}
