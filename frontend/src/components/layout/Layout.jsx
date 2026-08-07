import React, { useEffect } from 'react';

import { useProfileStore } from '../../store/profileStore';
import KeyboardShortcuts from '../shared/KeyboardShortcuts';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function Layout({ children }) {
  const loadProfiles = useProfileStore((state) => state.loadProfiles);

  // Load profiles once when the authenticated layout mounts
  useEffect(() => {
    loadProfiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopBar />
        <main className="flex-1 p-6">{children}</main>
      </div>
      <KeyboardShortcuts />
    </div>
  );
}
