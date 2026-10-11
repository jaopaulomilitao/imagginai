import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'interacxr',
    },
    rolldownOptions: {
      // o a-frame (e o three embutido nele) é fornecido pela aplicação hospedeira
      external: ['aframe'],
    },
    sourcemap: true,
    emptyOutDir: true,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
