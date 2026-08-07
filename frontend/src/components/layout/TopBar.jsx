import { Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { useThemeStore } from '../../store/themeStore';

// Pill for a single profile or the combined view
function ProfilePill({ profile, isActive, onClick }) {
  const bg = isActive ? profile.color : 'transparent';
  const border = isActive ? profile.color : '#475569'; // slate-600
  return (
    <button
      type="button"
      onClick={onClick}
      title={profile.name}
      style={{ borderColor: border, background: isActive ? profile.color : 'transparent' }}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all
        ${isActive ? 'text-white shadow-sm' : 'text-slate-300 hover:border-slate-400 hover:text-slate-100'}`}
    >
      {/* Avatar circle */}
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ background: isActive ? 'rgba(255,255,255,0.25)' : profile.color, color: '#fff' }}
      >
        {profile.avatarInitial || profile.name?.charAt(0)?.toUpperCase() || '?'}
      </span>
      <span className="max-w-[64px] truncate">{profile.name}</span>
    </button>
  );
}

// Combined pill (two overlapping circles icon)
function CombinedPill({ isActive, onClick, color = '#6366f1' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Combined view"
      style={{ borderColor: isActive ? color : '#475569', background: isActive ? color : 'transparent' }}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all
        ${isActive ? 'text-white shadow-sm' : 'text-slate-300 hover:border-slate-400 hover:text-slate-100'}`}
    >
      {/* Two overlapping circles icon */}
      <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="shrink-0">
        <circle cx="4.5" cy="5" r="4" fill={isActive ? 'rgba(255,255,255,0.3)' : color} />
        <circle cx="9.5" cy="5" r="4" fill={isActive ? 'rgba(255,255,255,0.3)' : color} />
      </svg>
      Combined
    </button>
  );
}

export default function TopBar() {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const user         = useAuthStore((state) => state.user);
  const logout       = useAuthStore((state) => state.logout);
  const theme        = useThemeStore((state) => state.theme);
  const toggleTheme  = useThemeStore((state) => state.toggleTheme);
  const [open, setOpen] = useState(false);
  const dropdownRef  = useRef(null);

  const profiles        = useProfileStore((state) => state.profiles);
  const activeProfileId = useProfileStore((state) => state.activeProfileId);
  const setActiveProfile = useProfileStore((state) => state.setActiveProfile);

  const showSwitcher = profiles.length > 1;

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

  const handleSwitchProfile = (profileId) => {
    setActiveProfile(profileId);
    // Invalidate all cached queries so pages re-fetch with the new profile header
    queryClient.invalidateQueries();
  };

  const initial = user?.fullName
    ? user.fullName.charAt(0).toUpperCase()
    : user?.email
    ? user.email.charAt(0).toUpperCase()
    : '?';

  const go = (path) => { setOpen(false); navigate(path); };
  const handleLogout = async () => { setOpen(false); await logout(); };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-3">
      {/* Left: brand + profile switcher */}
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-slate-100">RetireView</h1>

        {showSwitcher && (
          <div className="flex items-center gap-1.5">
            {profiles.map((profile) => (
              <ProfilePill
                key={profile.id}
                profile={profile}
                isActive={activeProfileId === profile.id}
                onClick={() => handleSwitchProfile(profile.id)}
              />
            ))}
            <CombinedPill
              isActive={activeProfileId === null}
              onClick={() => handleSwitchProfile(null)}
              color={profiles[0]?.color ?? '#6366f1'}
            />
          </div>
        )}
      </div>

      {/* Right: theme toggle + user menu */}
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
