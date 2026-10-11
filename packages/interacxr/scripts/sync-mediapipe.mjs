// copia os arquivos wasm do mediapipe (pacote npm fixado) para a pasta pública da aplicação
// e verifica se o modelo hand_landmarker.task foi colocado manualmente
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// o carregador em módulo es6 (useModule = true) usa apenas esta variante
const WASM_FILES = ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm'];
const MODEL_FILE = 'hand_landmarker.task';
const MODEL_SOURCE_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function resolveWasmDir() {
  // o pacote não exporta package.json; a pasta wasm fica ao lado do ponto de entrada
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@mediapipe/tasks-vision');
  return join(dirname(entry), 'wasm');
}

function copyWasm(targetDir) {
  const sourceDir = resolveWasmDir();
  const wasmTarget = join(targetDir, 'wasm');
  mkdirSync(wasmTarget, { recursive: true });
  for (const file of WASM_FILES) {
    const source = join(sourceDir, file);
    const target = join(wasmTarget, file);
    // a cópia é pulada quando o arquivo de destino já tem o mesmo tamanho
    if (existsSync(target) && statSync(target).size === statSync(source).size) continue;
    copyFileSync(source, target);
    process.stdout.write(`[sync-mediapipe] copied ${file}\n`);
  }
}

function checkModel(targetDir, strict) {
  const modelPath = join(targetDir, MODEL_FILE);
  if (existsSync(modelPath)) return;
  const message =
    `[sync-mediapipe] missing ${modelPath}\n` +
    `  download it once from ${MODEL_SOURCE_URL}\n` +
    `  and save it at that path (it is committed to git).\n`;
  process.stderr.write(message);
  if (strict) process.exit(1);
}

const [targetArgument, ...flags] = process.argv.slice(2);
if (!targetArgument) {
  process.stderr.write('usage: sync-mediapipe.mjs <public-mediapipe-dir> [--strict]\n');
  process.exit(1);
}
const targetDir = resolve(targetArgument);
copyWasm(targetDir);
checkModel(targetDir, flags.includes('--strict'));
