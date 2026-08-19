import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(rootDir, 'client'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(rootDir, 'shared'),
      '@': path.resolve(rootDir, 'client/src'),
    },
  },
  server: {
    port: 5173,
    // Bind all interfaces so the dev server is reachable from a phone on the LAN.
    host: true,
    // shared/ lives outside client/, so Vite needs explicit permission to read it
    fs: { allow: [rootDir] },
    proxy: {
      // 127.0.0.1, NOT localhost — Node resolves localhost to ::1 first, and the
      // proxy then intermittently ECONNREFUSEs against a server bound to 0.0.0.0.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      // ws:true is required or the socket falls back to polling forever in dev
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(rootDir, 'client/dist'),
    emptyOutDir: true,
  },
});
