import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    outDir: '.model-test',
    emptyOutDir: true,
    target: 'es2022',
    lib: { entry: './scripts/model-tests/entry.ts', formats: ['es'], fileName: 'entry' },
    rollupOptions: { external: [] },
  },
});
