import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';
import {
  appConfigPlugin,
  findDirectoryContaining,
  resolveAppConfigRoot,
} from './vite-app-config-plugin';

const overlayRoot = process.env.OVERLAY_ROOT
  ? resolve(process.env.OVERLAY_ROOT)
  : null;

function overlay(subPath: string, fallback: string): string {
  if (overlayRoot) {
    const candidate = resolve(overlayRoot, subPath);
    if (existsSync(candidate)) return candidate;
  }
  return resolve(findDirectoryContaining(fallback), fallback);
}

const aliases = {
  '~auth': overlay('auth/src/index.ts', 'src/auth-noop.ts'),
  '~github-app-template-link': overlay(
    'github-app-template-link/src/index.ts',
    'src/components/integrations/form/github-app-template-link.ts',
  ),
  '~admin-section-extensions': overlay(
    'admin-sections/src/index.ts',
    'src/config/admin-section-extensions-noop.ts',
  ),
};

export default defineConfig({
  base: '/',
  define: {
    __BACKEND_URL__: JSON.stringify(process.env.BACKEND_URL ?? ''),
  },
  plugins: [
    appConfigPlugin(resolveAppConfigRoot),
    react(),
    tailwindcss(),
    nodePolyfills({
      include: ['buffer', 'process', 'stream', 'util', 'events', 'http'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['index.html'],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: Number(process.env.PORT ?? 3333),
    strictPort: true,
    cors: true,
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL ?? 'http://localhost:7008',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: id => {
          if (id.includes('/react-dom/') || id.includes('/react/'))
            return 'react-vendor';
          if (id.includes('/react-router')) return 'router';
        },
      },
    },
  },
  resolve: {
    alias: aliases,
    dedupe: ['react', 'react-dom', 'react-router'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router'],
  },
});
