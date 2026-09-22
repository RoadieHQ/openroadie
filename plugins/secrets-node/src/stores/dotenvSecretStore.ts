/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { promises as fs } from 'fs';
import { dirname } from 'path';

import type { LoggerService } from '@roadiehq/extensions-api';
import {
  fromStoredSecretRef,
  maskSecret,
  toStoredSecretRef,
  type SecretStoreInfo,
  type SecretStoreService,
} from '../secretStore';

export interface DotenvSecretStoreOptions {
  filePath: string;
  logger: LoggerService;
}

/**
 * Parse a buffer of `.env`-format text into a map of KEY -> VALUE.
 *
 * Supported:
 *   KEY=value
 *   KEY="quoted value"
 *   KEY='single quoted'
 *   # comments and blank lines
 *
 * Unsupported (skipped + logged by caller):
 *   export KEY=value, multiline values
 */
export function parseDotenv(
  raw: string,
  onMalformed?: (line: string) => void,
): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      onMalformed?.(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      onMalformed?.(line);
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      const inner = value.slice(1, -1);
      value = value.startsWith('"')
        ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"')
        : inner;
    }
    out[key] = value;
  }
  return out;
}

export function serializeDotenv(values: Record<string, string>): string {
  const keys = Object.keys(values).sort();
  const lines = keys.map(key => {
    const value = values[key];
    const needsQuoting = /["\n\r#\s]/.test(value) || value === '';
    if (!needsQuoting) {
      return `${key}=${value}`;
    }
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const normalised = escaped.replace(/\n/g, '\\n');
    return `${key}="${normalised}"`;
  });
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

export function createDotenvSecretStore(
  options: DotenvSecretStoreOptions,
): SecretStoreService {
  const { filePath, logger } = options;
  const info: SecretStoreInfo = {
    mode: 'dotenv',
    readOnly: false,
    dotenvPath: filePath,
  };

  const readAll = async (): Promise<Record<string, string>> => {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return parseDotenv(raw, bad =>
        logger.warn(`Skipping malformed line in ${filePath}: ${bad}`),
      );
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return {};
      }
      throw e;
    }
  };

  const writeAll = async (next: Record<string, string>): Promise<void> => {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const dir = dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Directory may already exist or be unwritable; let the write itself
      // surface the actual error.
    }
    await fs.writeFile(tmpPath, serializeDotenv(next), { mode: 0o600 });
    await fs.rename(tmpPath, filePath);
    try {
      await fs.chmod(filePath, 0o600);
    } catch {
      // Not all filesystems (notably on Windows or some CI sandboxes)
      // support chmod; the write+rename is the primary integrity guarantee.
    }
  };

  let mutationQueue = Promise.resolve();
  const mutate = (update: (values: Record<string, string>) => boolean) => {
    const pending = mutationQueue.then(async () => {
      const all = await readAll();
      if (update(all)) {
        await writeAll(all);
      }
    });
    mutationQueue = pending.catch(() => undefined);
    return pending;
  };

  return {
    resolver: scope => ({
      async resolve(refs, options) {
        const all = await readAll();
        const out: Record<string, string> = {};
        for (const ref of refs) {
          const storedRef = toStoredSecretRef(ref, scope);
          if (all[storedRef] !== undefined) {
            out[ref] = options?.masked
              ? maskSecret(all[storedRef])
              : all[storedRef];
          }
        }
        return out;
      },
    }),
    writer: scope => ({
      readOnly: false,
      async put(ref, value) {
        await mutate(all => {
          all[toStoredSecretRef(ref, scope)] = value;
          return true;
        });
      },
      async delete(ref) {
        await mutate(all => {
          const storedRef = toStoredSecretRef(ref, scope);
          if (all[storedRef] === undefined) {
            return false;
          }
          delete all[storedRef];
          return true;
        });
      },
      async listRefs() {
        return Object.keys(await readAll()).flatMap(ref => {
          const logicalRef = fromStoredSecretRef(ref, scope);
          return logicalRef ? [logicalRef] : [];
        });
      },
      async exists(ref) {
        const all = await readAll();
        return all[toStoredSecretRef(ref, scope)] !== undefined;
      },
    }),
    info: () => info,
  };
}
