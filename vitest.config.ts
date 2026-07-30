import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'es-toolkit/compat': path.resolve(__dirname, 'node_modules/es-toolkit/dist/compat/index.js'),
    },
  },
  test: {
    exclude: ['node_modules', '.stryker-tmp', '.wxt', '.output', 'dist'],
  },
});
