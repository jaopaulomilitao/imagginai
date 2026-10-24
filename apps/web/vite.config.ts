import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// o certificado autoassinado é ativado apenas no modo "https", usado para testes no celular
export default defineConfig(({ mode }) => {
  const pwaPlugin = VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['zone.html', 'demo-packs/*.json', 'mediapipe/**/*'],
    manifest: {
      name: 'IMAGGINAI — Estudo Espacial WebXR',
      short_name: 'IMAGGINAI',
      description: 'Ambiente espacial de estudo WebXR com rastreamento de mãos e grounding em PDF.',
      theme_color: '#05070B',
      background_color: '#05070B',
      display: 'standalone',
      lang: 'pt-BR',
      start_url: '/index.html',
    },
    workbox: {
      maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      globPatterns: ['**/*.{js,css,html,json,wasm,task}'],
      navigateFallback: null,
    },
  });

  const basePlugins = [tailwindcss(), react(), pwaPlugin];

  return {
    envDir: '../..',
    plugins: mode === 'https' ? [...basePlugins, basicSsl()] : basePlugins,
    server: {
      port: 5173,
    },
    build: {
      // o bundle da zona reúne a-frame (three.js), troika-three-text e pdfjs-dist para uso offline
      chunkSizeWarningLimit: 2500,
      rolldownOptions: {
        input: {
          main: 'index.html',
          zone: 'zone.html',
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});
