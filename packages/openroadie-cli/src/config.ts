import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The CLI's only persisted state: where the backend lives. Everything else
 * (connected / indexed / rules / sources) is recomputed from live endpoints on
 * every run, so no `.openroadie-state.json` is ever written. The catalog is
 * queryable without credentials in single-tenant OSS, so the CLI carries no
 * token.
 */
export interface OpenRoadieConfig {
  backendUrl: string;
}

const DEFAULT_BACKEND_URL = 'http://localhost:7008';

/**
 * Resolve the config file path: `OPENROADIE_CONFIG` overrides the default
 * `~/.openroadie/config.json`.
 */
export function configPath(): string {
  const override = process.env.OPENROADIE_CONFIG;
  if (override && override.trim() !== '') {
    return override;
  }
  return join(homedir(), '.openroadie', 'config.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Load config from disk, falling back to a default backend URL when the file is
 * absent. A malformed file throws so the caller can surface a clear error.
 */
export function loadConfig(): OpenRoadieConfig {
  const path = configPath();
  if (!existsSync(path)) {
    return { backendUrl: DEFAULT_BACKEND_URL };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read config at ${path}: ${reason}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Config at ${path} is not a JSON object.`);
  }

  const backendUrl =
    typeof parsed.backendUrl === 'string' && parsed.backendUrl.trim() !== ''
      ? parsed.backendUrl
      : DEFAULT_BACKEND_URL;

  return { backendUrl };
}
