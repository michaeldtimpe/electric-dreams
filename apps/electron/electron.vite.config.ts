import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@ed/shared'] })],
    resolve: {
      alias: { '@ed/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@ed/shared'] })],
    resolve: {
      alias: { '@ed/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    resolve: {
      alias: { '@ed/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
    },
    build: {
      rollupOptions: {
        input: {
          visuals: resolve(__dirname, 'src/renderer/visuals/index.html'),
          audio: resolve(__dirname, 'src/renderer/audio/index.html'),
        },
      },
    },
  },
});
