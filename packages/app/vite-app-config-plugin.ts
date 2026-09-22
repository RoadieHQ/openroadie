import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import type { Plugin } from 'vite';

export const APP_CONFIG_MODULE_ID = '~app-config';
const VIRTUAL_ID = '\0roadie:app-config';

/** Walk up from startDir until marker exists. */
export function findDirectoryContaining(
  marker: string,
  startDir = process.cwd(),
): string {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 10; depth++) {
    if (existsSync(resolve(dir, marker))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find "${marker}" walking up from ${startDir}`);
}

export function resolveAppConfigRoot(): string {
  if (process.env.APP_CONFIG_ROOT) {
    return resolve(process.env.APP_CONFIG_ROOT);
  }
  return findDirectoryContaining('app-config.yaml');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = new Map<string, unknown>(Object.entries(target));
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result.get(key);
    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result.set(key, deepMerge(targetValue, sourceValue));
    } else {
      result.set(key, sourceValue);
    }
  }
  return Object.fromEntries(result);
}

function parseYamlFile(path: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return {};
  return (yaml.load(raw) as Record<string, unknown>) ?? {};
}

function configFilePaths(
  root: string,
  includeDevelopment: boolean,
): { path: string; required: boolean }[] {
  const files: { path: string; required: boolean }[] = [
    { path: resolve(root, 'app-config.yaml'), required: true },
  ];
  if (includeDevelopment) {
    files.push({
      path: resolve(root, 'app-config.development.yaml'),
      required: false,
    });
  }
  files.push({ path: resolve(root, 'app-config.local.yaml'), required: false });
  return files;
}

function loadMergedAppConfig(
  root: string,
  includeDevelopment: boolean,
): Record<string, unknown> {
  let merged: Record<string, unknown> = {};
  for (const { path, required } of configFilePaths(root, includeDevelopment)) {
    if (!existsSync(path)) {
      if (required) {
        throw new Error(`Missing required app config: ${path}`);
      }
      continue;
    }
    merged = deepMerge(merged, parseYamlFile(path));
  }
  return merged;
}

export function appConfigPlugin(appConfigRoot: () => string): Plugin {
  let includeDevelopment = true;
  let watchedPaths: string[] = [];

  return {
    name: 'roadie-app-config',
    configResolved(config) {
      includeDevelopment =
        config.command === 'serve' || config.mode === 'development';
      watchedPaths = configFilePaths(appConfigRoot(), includeDevelopment)
        .map(({ path }) => path)
        .filter(existsSync);
    },
    resolveId(source) {
      if (source === APP_CONFIG_MODULE_ID) return VIRTUAL_ID;
      return undefined;
    },
    load(id) {
      if (id !== VIRTUAL_ID) return undefined;
      const merged = loadMergedAppConfig(appConfigRoot(), includeDevelopment);
      return `export default ${JSON.stringify(merged)};`;
    },
    configureServer(server) {
      for (const path of watchedPaths) {
        server.watcher.add(path);
      }
    },
    handleHotUpdate({ file, server }) {
      if (!watchedPaths.includes(file)) return;
      const mod = server.moduleGraph.getModuleById(VIRTUAL_ID);
      if (!mod) return;
      server.moduleGraph.invalidateModule(mod);
      return [mod];
    },
  };
}
