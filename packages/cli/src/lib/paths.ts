import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findRootDir(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    try {
      const pkgPath = resolve(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const json = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (json.workspaces) {
          return dir;
        }
      }
    } catch {}
    dir = dirname(dir);
  }
  return process.cwd();
}

export const paths = {
  targetDir: process.cwd(),
  targetRoot: findRootDir(),
  ownDir: resolve(__dirname, '..', '..'),

  resolveTarget(...segments: string[]): string {
    return resolve(this.targetDir, ...segments);
  },

  resolveTargetRoot(...segments: string[]): string {
    return resolve(this.targetRoot, ...segments);
  },

  resolveOwn(...segments: string[]): string {
    return resolve(this.ownDir, ...segments);
  },
};
