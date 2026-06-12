import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@ed/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
