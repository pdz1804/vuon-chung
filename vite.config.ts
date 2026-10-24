import { defineConfig } from 'vite';

// three.js and Firebase change rarely: separate chunks stay cached across game updates.
export default defineConfig({
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
