import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// o certificado autoassinado é ativado apenas no modo "https", usado para testes no celular
export default defineConfig(({ mode }) => ({
  envDir: '../..',
  plugins: mode === 'https' ? [react(), basicSsl()] : [react()],
  server: {
    port: 5173,
  },
  build: {
    // o a-frame embute o three.js (~1,3 mb minificado) em um único módulo indivisível
    chunkSizeWarningLimit: 1500,
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
}));
