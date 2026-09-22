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

import {
  coreServices,
  createServiceFactory,
  createServiceRef,
  type LoggerService,
} from '@roadiehq/extensions-api';
import type { Config } from '@roadiehq/config';
import { InputError } from '@roadiehq/errors';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

import { createEnvSecretStore } from './stores/envSecretStore';
import { createDotenvSecretStore } from './stores/dotenvSecretStore';

export interface ResolveOptions {
  masked?: boolean;
}

export interface SecretStoreScope {
  workspaceId?: string;
}

export interface SecretResolver {
  /**
   * Resolve a batch of secret references. Implementations return only
   * the refs that were successfully resolved; missing refs are omitted
   * from the result map rather than thrown, so callers can distinguish
   * "not set" from "store error".
   *
   * Pass `{ masked: true }` to return masked values suitable for display,
   * replacing each character with a bullet.
   */
  resolve(
    refs: string[],
    options?: ResolveOptions,
  ): Promise<Record<string, string>>;
}

export interface SecretWriter {
  readonly readOnly: boolean;
  put(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
  listRefs(): Promise<string[]>;
  exists(ref: string): Promise<boolean>;
}

export type SecretStorageMode = 'env' | 'dotenv' | 'scoped';

export interface SecretStoreInfo {
  mode: SecretStorageMode;
  readOnly: boolean;
  dotenvPath?: string;
}

export interface SecretStoreService {
  resolver(scope?: SecretStoreScope): SecretResolver;
  writer(scope?: SecretStoreScope): SecretWriter;
  info(): SecretStoreInfo;
  getCreatedAt?(
    refs: string[],
    scope?: SecretStoreScope,
  ): Promise<Record<string, string>>;
  getLastModified?(
    refs: string[],
    scope?: SecretStoreScope,
  ): Promise<Record<string, string>>;
}

const WORKSPACE_SECRET_PREFIX = 'OPENROADIE_WORKSPACE_';

export function isWorkspaceSecretRef(ref: string): boolean {
  return ref.startsWith(WORKSPACE_SECRET_PREFIX);
}

export function toStoredSecretRef(
  ref: string,
  scope?: SecretStoreScope,
): string {
  if (isWorkspaceSecretRef(ref)) {
    throw new InputError('Secret reference uses a reserved prefix');
  }
  const workspaceId = scope?.workspaceId;
  if (!workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) {
    return ref;
  }
  return `${WORKSPACE_SECRET_PREFIX}${workspaceId.replaceAll('-', '_')}__${ref}`;
}

export function fromStoredSecretRef(
  ref: string,
  scope?: SecretStoreScope,
): string | undefined {
  const workspaceId = scope?.workspaceId;
  if (!workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) {
    return isWorkspaceSecretRef(ref) ? undefined : ref;
  }
  const prefix = `${WORKSPACE_SECRET_PREFIX}${workspaceId.replaceAll('-', '_')}__`;
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
}

export interface BootstrapSecretsLoaderService {
  load(): Promise<Record<string, string>>;
}

export interface BootstrapSecretsSyncAuthorizerService {
  authorize(options: { authorizationHeader?: string }): Promise<void>;
}

export function maskSecret(value: string): string {
  return '•'.repeat(value.length);
}

export class SecretStoreReadOnlyError extends Error {
  readonly name = 'SecretStoreReadOnlyError';
  constructor(message = 'Secret store is read-only') {
    super(message);
  }
}

/**
 * Thrown when the backing secret store exists but is not (yet) provisioned
 * for the current tenant. The message is shown to end users, so it must be
 * actionable for them — operator detail belongs in the server log, not here.
 */
export class SecretStoreNotProvisionedError extends Error {
  readonly name = 'SecretStoreNotProvisionedError';
  constructor(
    message = 'Secret storage has not been set up for this account yet. Please contact support.',
  ) {
    super(message);
  }
}

export class BootstrapSecretsSyncAuthorizationError extends Error {
  readonly name = 'BootstrapSecretsSyncAuthorizationError';
  readonly statusCode: number;

  constructor(message: string, options?: { statusCode?: number }) {
    super(message);
    this.statusCode = options?.statusCode ?? 403;
  }
}

export function selectOssStoreFromConfig(options: {
  config: Config;
  logger: LoggerService;
}): SecretStoreService {
  const { config, logger } = options;
  const mode =
    (config.getOptionalString('secretsSettings.storage') as
      | SecretStorageMode
      | undefined) ?? 'dotenv';

  if (mode === 'env') {
    return createEnvSecretStore({
      logger,
      declaredRefs: () => readDeclaredRefs(config),
    });
  }

  if (mode === 'dotenv') {
    const filePath =
      config.getOptionalString('secretsSettings.dotenvPath') ??
      './.secrets.env';
    return createDotenvSecretStore({ filePath, logger });
  }

  logger.warn(
    `Unknown secretsSettings.storage value "${mode}"; falling back to dotenv`,
  );
  return createDotenvSecretStore({
    filePath: './.secrets.env',
    logger,
  });
}

function readDeclaredRefs(config: Config): string[] {
  try {
    const arr = config.getOptionalConfigArray('secretsSettings.secrets');
    if (!arr) {
      return [];
    }
    return arr
      .map(c => c.getOptionalString('internalName'))
      .filter((v): v is string => !!v);
  } catch {
    return [];
  }
}

export const secretStoreServiceRef = createServiceRef<SecretStoreService>({
  id: 'integrations.secretStore',
  scope: 'root',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.rootLogger,
      },
      async factory({ config, logger }) {
        return selectOssStoreFromConfig({ config, logger });
      },
    }),
});

export const bootstrapSecretsLoaderServiceRef =
  createServiceRef<BootstrapSecretsLoaderService>({
    id: 'integrations.bootstrapSecretsLoader',
    scope: 'root',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: {},
        async factory() {
          return {
            async load() {
              return {};
            },
          };
        },
      }),
  });

export const bootstrapSecretsSyncAuthorizerServiceRef =
  createServiceRef<BootstrapSecretsSyncAuthorizerService>({
    id: 'integrations.bootstrapSecretsSyncAuthorizer',
    scope: 'root',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: {},
        async factory() {
          return {
            async authorize() {
              throw new BootstrapSecretsSyncAuthorizationError(
                'Bootstrap secret runtime sync is disabled',
              );
            },
          };
        },
      }),
  });
