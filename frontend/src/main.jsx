import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { queryClient } from './lib/queryClient';
import { useThemeStore } from './store/themeStore';
import './styles.css';

// Apply the persisted theme before first paint to avoid a flash.
let savedTheme = 'dark';
try {
  const raw = localStorage.getItem('app-theme');
  if (raw) {
    savedTheme = JSON.parse(raw)?.state?.theme || 'dark';
  }
} catch (_error) {
  savedTheme = 'dark';
}
document.documentElement.classList.remove('dark', 'light');
document.documentElement.classList.add(savedTheme);
useThemeStore.getState().setTheme(savedTheme);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
