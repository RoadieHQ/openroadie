import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoggerService } from '@roadiehq/extensions-api';
import { createEnvSecretStore } from './envSecretStore';
import { toStoredSecretRef } from '../secretStore';

const logger: LoggerService = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => logger,
};

const workspaceId = 'personal-workspace';
const secretRef = 'GITHUB_TOKEN';
const storedRef = toStoredSecretRef(secretRef, { workspaceId });

describe('createEnvSecretStore', () => {
  afterEach(() => {
    delete process.env[storedRef];
  });

  it('lists declared refs for a workspace and resolves its stored value', async () => {
    process.env[storedRef] = 'workspace-secret';
    const store = createEnvSecretStore({
      logger,
      declaredRefs: () => [secretRef],
    });

    await expect(store.writer({ workspaceId }).listRefs()).resolves.toEqual([
      secretRef,
    ]);
    await expect(
      store.resolver({ workspaceId }).resolve([secretRef]),
    ).resolves.toEqual({ [secretRef]: 'workspace-secret' });
  });
});
