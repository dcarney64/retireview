import { Moon, Sun } from 'lucide-react';

import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { Button } from '../ui/button';

export default function TopBar() {
  const logout = useAuthStore((state) => state.logout);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
      <div className="flex items-center gap-3">
        {/* TODO: replace with your app name / logo */}
        <h1 className="text-lg font-semibold text-slate-100">RetireView</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* TODO: add app-wide controls here (search, notifications, ...) */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          type="button"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <Button className="bg-slate-700 hover:bg-slate-600" onClick={logout}>Sign Out</Button>
      </div>
    </header>
  );
}
