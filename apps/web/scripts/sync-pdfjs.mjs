// copia o worker minificado do pdfjs-dist para a pasta pública da aplicação web
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const workerSource = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
const targetDir = resolve('public/pdfjs');
const targetFile = join(targetDir, 'pdf.worker.min.mjs');

mkdirSync(targetDir, { recursive: true });
if (!existsSync(targetFile) || statSync(targetFile).size !== statSync(workerSource).size) {
  copyFileSync(workerSource, targetFile);
  process.stdout.write('[sync-pdfjs] copied pdf.worker.min.mjs to public/pdfjs\n');
}
