import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Output goes under src/ so electron-builder's "src/**/*" glob packs it without a new "files" entry.
// base './' because the page loads from file:// under a strict CSP.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../src/ui-dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
