import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoggerService } from '@roadiehq/extensions-api';
import { createDotenvSecretStore, parseDotenv } from './dotenvSecretStore';

const logger: LoggerService = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => logger,
};

describe('createDotenvSecretStore', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map(directory => rm(directory, { recursive: true, force: true })),
    );
  });

  it('preserves concurrent writes from different workspaces', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openroadie-secrets-'));
    directories.push(directory);
    const filePath = join(directory, '.secrets.env');
    const store = createDotenvSecretStore({ filePath, logger });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store
          .writer({ workspaceId: `workspace-${index}` })
          .put('SHARED_REF', `value-${index}`),
      ),
    );

    const stored = parseDotenv(await readFile(filePath, 'utf8'));
    expect(Object.keys(stored)).toHaveLength(20);
  });
});
