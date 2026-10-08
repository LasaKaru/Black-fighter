import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/rooms': { target: 'http://localhost:8787' },
      '/leaderboard': { target: 'http://localhost:8787' },
      '/cloud': { target: 'http://localhost:8787' },
      '/analytics': { target: 'http://localhost:8787' },
      '/brand': { target: 'http://localhost:8787' },
      '/panel': { target: 'http://localhost:8787' },
    },
  },
  build: {
    target: 'es2022',
    // rapier3d-compat inlines its WASM as base64 (~4.3 MB raw / 1.7 MB gzip);
    // it lives in its own long-cached chunk
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('@dimforge/rapier3d')) return 'rapier';
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
});
