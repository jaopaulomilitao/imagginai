import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// localiza o binário do uv no path ou nos diretórios padrão do winget/usuário no windows
function resolveUvExecutable() {
  const probe = spawnSync('uv', ['--version'], { stdio: 'ignore', shell: false });
  if (probe.status === 0) {
    return 'uv';
  }

  const candidates = [
    join(homedir(), '.local', 'bin', 'uv.exe'),
    join(homedir(), '.cargo', 'bin', 'uv.exe'),
  ];

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(join(localAppData, 'Microsoft', 'WinGet', 'Links', 'uv.exe'));
    const packagesDir = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (existsSync(packagesDir)) {
      for (const entry of readdirSync(packagesDir)) {
        if (entry.startsWith('astral-sh.uv')) {
          candidates.push(join(packagesDir, entry, 'uv.exe'));
        }
      }
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'uv';
}

const uvBin = resolveUvExecutable();
const args = process.argv.slice(2);
const result = spawnSync(uvBin, args, {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);

