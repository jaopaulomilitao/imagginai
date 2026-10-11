import { fileURLToPath } from 'node:url';

import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// o exemplo consome o build da biblioteca (dist) e reaproveita os arquivos do mediapipe
// hospedados pela aplicação web em apps/web/public/mediapipe
export default defineConfig(({ mode }) => ({
  root: fromHere('.'),
  publicDir: fromHere('../../../../apps/web/public'),
  plugins: mode === 'https' ? [basicSsl()] : [],
  resolve: {
    alias: { interacxr: fromHere('../../dist/interacxr.js') },
  },
  build: {
    outDir: fromHere('dist'),
    emptyOutDir: true,
    // o a-frame embute o three.js (~1,3 mb minificado) em um único módulo indivisível
    chunkSizeWarningLimit: 1500,
  },
}));
