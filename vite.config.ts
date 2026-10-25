import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// three.js and Firebase change rarely: separate chunks stay cached across game updates.
export default defineConfig({
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      // Precache the app shell only; models are cached at runtime by the worker.
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 3_000_000 },
      manifest: {
        name: 'Vườn Chung',
        short_name: 'Vườn Chung',
        description: 'A cozy two-player garden you grow together.',
        lang: 'vi',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fff8e8',
        theme_color: '#477a4a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/database'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
