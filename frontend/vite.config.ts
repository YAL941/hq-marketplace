import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks: stable across deploys, cached longest.
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-i18n': ['i18next', 'i18next-browser-languagedetector', 'react-i18next'],
          'vendor-ui': ['lucide-react', 'clsx', 'axios'],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      /*
       * Uploaded images.
       *
       * The API stores an image as the path `/uploads/<businessId>/...`, and
       * the database keeps that path verbatim so the row survives a change of
       * storage driver. Serving the folder from this dev server as well is what
       * makes the path work unchanged in the browser: without this entry the
       * page would ask Vite for `/uploads/...`, get the SPA fallback instead of
       * an image, and every logo would render broken.
       */
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});