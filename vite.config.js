import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^react-router$/,
        replacement: resolve(projectRoot, 'node_modules/react-router/dist/production/index.mjs'),
      },
      {
        find: /^react-router\/dom$/,
        replacement: resolve(projectRoot, 'node_modules/react-router/dist/production/dom-export.mjs'),
      },
    ],
  },
  server: {
    host: 'localhost',
    port: 5173,
  },
});
