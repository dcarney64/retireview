import {
  Building2,
  LayoutDashboard,
  LineChart,
  Target,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { useAuthStore } from '../../store/authStore';

const mainItems = [
  { label: 'Dashboard',   path: '/',            icon: LayoutDashboard },
  { label: 'Net Worth',   path: '/net-worth',   icon: TrendingUp      },
  { label: 'Performance', path: '/performance', icon: LineChart       },
  { label: 'Real Estate', path: '/real-estate', icon: Building2       },
  { label: 'Accounts',    path: '/accounts',    icon: Wallet          },
  { label: 'Import Data', path: '/import',      icon: Upload          },
  { label: 'Retirement',  path: '/retirement',  icon: Target          },
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

export default function Sidebar() {
  const location = useLocation();
  const user     = useAuthStore((state) => state.user);

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

  return (
    <aside className="w-72 shrink-0 border-r border-slate-800 bg-slate-900 p-4">
      <nav className="space-y-1">
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
