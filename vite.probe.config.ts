import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    outDir: '.probe',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: { probe: './src/audio/encode.ts' },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: '[name].js', chunkFileNames: 'c-[name].js', assetFileNames: 'a-[name][extname]' },
    },
  },
});
