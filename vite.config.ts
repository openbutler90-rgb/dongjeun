import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GOOGLE_MAPS_PLATFORM_KEY': JSON.stringify(env.GOOGLE_MAPS_PLATFORM_KEY || ''),
      'import.meta.env.VITE_ONESIGNAL_APP_ID': JSON.stringify(env.VITE_ONESIGNAL_APP_ID || ''),
      'import.meta.env.VITE_ONESIGNAL_REST_API_KEY': JSON.stringify(env.VITE_ONESIGNAL_REST_API_KEY || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Firebase는 무거우므로 별도 청크로 분리
            'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            // React 핵심 라이브러리
            'react-vendor': ['react', 'react-dom', 'react-router'],
            // 기타 무거운 라이브러리
            'ui-vendor': ['date-fns', 'zustand'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
