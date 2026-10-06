import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/rooms': { target: 'http://localhost:8787' },
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
