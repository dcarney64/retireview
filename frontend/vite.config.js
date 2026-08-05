import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    proxy: {
      // For HTTPS: change target to 'https://localhost:8443'
      // and add: secure: false (for self-signed cert)
      '/api': 'http://localhost:8006',
    },
    watch: {
      // Reduce watcher load in monorepos (parent node_modules)
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    },
  },
});
