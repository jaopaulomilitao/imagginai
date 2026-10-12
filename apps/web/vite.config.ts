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
}));
