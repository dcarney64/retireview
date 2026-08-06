import { Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';

export default function TopBar() {
  const navigate     = useNavigate();
  const user         = useAuthStore((state) => state.user);
  const logout       = useAuthStore((state) => state.logout);
  const theme        = useThemeStore((state) => state.theme);
  const toggleTheme  = useThemeStore((state) => state.toggleTheme);
  const [open, setOpen] = useState(false);
  const dropdownRef  = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const initial = user?.fullName
    ? user.fullName.charAt(0).toUpperCase()
    : user?.email
    ? user.email.charAt(0).toUpperCase()
    : '?';

  const go = (path) => { setOpen(false); navigate(path); };
  const handleLogout = async () => { setOpen(false); await logout(); };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">RetireView</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Light / dark toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Avatar button + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Open user menu"
            aria-expanded={open}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-sm font-semibold text-white transition-colors hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/60"
          >
            {initial}
          </button>

          {open && (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl shadow-black/40">
              {/* Identity header */}
              <div className="px-4 py-3">
                <div className="truncate font-semibold text-slate-100">
                  {user?.fullName || 'User'}
                </div>
                <div className="truncate text-xs text-slate-400">{user?.email}</div>
              </div>

              <div className="border-t border-slate-700" />

              <div className="py-1">
                <DropdownItem emoji="👤" label="Profile"         onClick={() => go('/settings')} />
                <DropdownItem emoji="🔗" label="Broker Settings" onClick={() => go('/broker-settings')} />
                <DropdownItem emoji="🔒" label="Security"        onClick={() => go('/settings#security')} />
              </div>

              <div className="border-t border-slate-700" />

              <div className="py-1">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-slate-800 hover:text-red-300"
                >
                  <span>🚪</span> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function DropdownItem({ emoji, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
    >
      <span>{emoji}</span>
      {label}
    </button>
  );
}
