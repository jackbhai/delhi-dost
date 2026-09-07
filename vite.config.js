import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BUILD = new Date().toISOString().slice(0,16).replace('T',' ');

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(BUILD) },
  server: { host: '0.0.0.0', port: 3000, strictPort: true, allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' } },
  build: { outDir: 'dist', target: 'es2020' },
});
