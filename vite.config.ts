import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base keeps the bundle loadable from Capacitor's capacitor:// / file:// origins.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'LiteDAW — Ear Trainer & Mini Studio',
        short_name: 'LiteDAW',
        description:
          'Avionics-inspired pitch trainer, BPM trainer and multitrack mini studio. Works offline.',
        theme_color: '#0C0F12',
        background_color: '#07090B',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['music', 'education', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,wasm}'],
        // mediabunny's wasm encoders (lame/flac/aac) are large; keep them out of the precache
        // and let them stream in on first export instead.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Only the core library is pinned to its own chunk. The
          // @mediabunny/*-encoder extensions must stay lazy, so they are
          // deliberately NOT matched here — rolldown splits them per
          // `import()` and they are fetched only when that export runs.
          if (id.includes('node_modules/mediabunny/')) return 'media';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: { host: true, port: 5273 },
  preview: { host: true, port: 5273 },
});
