/*
 * Copyright 2020 Larder Software Limited
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

import express from 'express';
import bodyParser from 'body-parser';
import Router from 'express-promise-router';
import { stat } from 'node:fs/promises';
import { Config } from '@roadiehq/config';
import { omit } from 'lodash';
import type { LoggerService } from '@roadiehq/extensions-api';
import type { HttpAuthService } from '@roadiehq/extensions-api';
import type { EventsService } from '@roadiehq/backend-defaults';
import type {
  BootstrapSecretsSyncAuthorizerService,
  SecretStoreService,
} from '@roadiehq/secrets-node';
import {
  BootstrapSecretsSyncAuthorizationError,
  isWorkspaceSecretRef,
  SecretStoreNotProvisionedError,
  SecretStoreReadOnlyError,
} from '@roadiehq/secrets-node';
import { Knex } from 'knex';

import { SCOPES } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import type { WorkspaceService } from '@roadiehq/workspaces-backend';

import { DatabaseSecretsMetadataStore } from '../lib/SecretsMetadataStore';
import type { SecretMetadata } from '../lib/RoadieSecretsStore';

export interface RouterOptions {
  logger: LoggerService;
  config: Config;
  httpAuth: HttpAuthService;
  events: EventsService;
  database: Knex;
  secretStore: SecretStoreService;
  bootstrapSecretsLoader: () => Promise<Record<string, string>>;
  bootstrapSecretsSyncAuthorizer: BootstrapSecretsSyncAuthorizerService;
  scopeService: ScopeService;
  workspaceService: WorkspaceService;
}

export type SecretStatus = 'Available' | 'Not Set';

export interface SecretListItem {
  name: string;
  ref: string;
  description?: string;
  status: SecretStatus;
  createdAt?: string;
  lastModified?: string;
  helpUrl?: string;
  isCustom?: boolean;
}

const ROADIE_MANAGED_GITHUB_SECRET_REFS = new Set([
  'GITHUB_APP_PRIVATE_KEY',
  'INTERNAL_GITHUB_APP_CLIENT_SECRET',
]);

export async function createRouter({
  logger,
  config,
  httpAuth,
  events,
  database,
  secretStore,
  bootstrapSecretsLoader,
  bootstrapSecretsSyncAuthorizer,
  scopeService,
  workspaceService,
}: RouterOptions): Promise<express.Router> {
  try {
    const pluginConfigKey = 'secretsSettings';
    logger.info('Starting secret settings plugin...');
    const pluginConfig = config.getOptionalConfig(pluginConfigKey);
    const builtinSecrets = pluginConfig
      ? loadConfiguredSecrets(pluginConfig)
      : [];

    const metadataStore = new DatabaseSecretsMetadataStore({
      builtin: builtinSecrets,
      database,
    });

    const router = Router();
    const requireScopes = scopeService.requireScopes;
    const jsonParser = bodyParser.json();
    const workspaceIds = new WeakMap<object, string>();

    router.use(async (req, _res, next) => {
      try {
        workspaceIds.set(req, await workspaceService.resolveWorkspaceId(req));
        next();
      } catch (error: unknown) {
        next(error);
      }
    });

    const getWorkspaceId = (req: express.Request): string => {
      const workspaceId = workspaceIds.get(req);
      if (!workspaceId) {
        throw new Error('Workspace was not resolved');
      }
      return workspaceId;
    };

    const info = secretStore.info();
    const hiddenSecretRefs =
      info.mode === 'scoped' ? ROADIE_MANAGED_GITHUB_SECRET_REFS : new Set();

    const isHiddenSecretRef = (ref: string) =>
      hiddenSecretRefs.has(ref) || isWorkspaceSecretRef(ref);
    const isHiddenSecret = (secret: SecretMetadata) =>
      isHiddenSecretRef(secret.internalKeyName);
    const findSecretByNameOrRef = (
      secrets: SecretMetadata[],
      secretNameOrRef: string,
    ) =>
      secrets.find(
        secret =>
          secret.name === secretNameOrRef ||
          secret.internalKeyName === secretNameOrRef,
      );
    const isHiddenSecretNameOrRef = (
      secrets: SecretMetadata[],
      secretNameOrRef: string,
    ) => {
      const matched = findSecretByNameOrRef(secrets, secretNameOrRef);
      return matched
        ? isHiddenSecret(matched)
        : isHiddenSecretRef(secretNameOrRef);
    };
    const visibleSecrets = (secrets: SecretMetadata[]) =>
      secrets.filter(secret => !isHiddenSecret(secret));

    router
      .route('/storage-mode')
      .get(requireScopes(SCOPES.secretsSettings.get), async (_req, res) => {
        const current = secretStore.info();
        res.status(200).send({
          mode: current.mode,
          readOnly: current.readOnly,
          ...(current.dotenvPath ? { dotenvPath: current.dotenvPath } : {}),
          ...(current.mode === 'scoped'
            ? { hiddenSecretRefs: Array.from(hiddenSecretRefs).sort() }
            : {}),
        });
      });

    router
      .route('/keys')
      .get(requireScopes(SCOPES.secretsSettings.query), async (req, res) => {
        try {
          const workspaceId = getWorkspaceId(req);
          const metadataList = visibleSecrets(
            await metadataStore.getSecrets(workspaceId),
          );
          const refs = metadataList.map(m => m.internalKeyName);
          const resolver = secretStore.resolver({ workspaceId });
          const existing = refs.length ? await resolver.resolve(refs) : {};
          const createdAtByRef = await getCreatedAtByRef(
            secretStore,
            refs,
            workspaceId,
          );
          const lastModifiedByRef = await getLastModifiedByRef(
            secretStore,
            refs,
            workspaceId,
          );
          const response: SecretListItem[] = metadataList.map(meta => ({
            name: meta.name,
            ref: meta.internalKeyName,
            description: meta.description,
            createdAt: createdAtByRef[meta.internalKeyName],
            lastModified: lastModifiedByRef[meta.internalKeyName],
            helpUrl: meta.helpUrl,
            isCustom: meta.isCustom,
            status:
              existing[meta.internalKeyName] !== undefined
                ? 'Available'
                : 'Not Set',
          }));
          res.status(200).send(response);
        } catch (e: unknown) {
          logger.warn(
            `error fetching all secrets: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          res.status(500).send('Error fetching all secrets');
        }
      });

    router
      .route('/secret-metadata')
      .get(requireScopes(SCOPES.secretsSettings.query), async (req, res) => {
        try {
          const metadataList = visibleSecrets(
            await metadataStore.getSecrets(getWorkspaceId(req)),
          );
          res
            .status(200)
            .send(metadataList.map(it => omit(it, 'internalKeyName')));
        } catch (e: unknown) {
          logger.warn(
            `error fetching all secrets: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          res.status(500).send('Error fetching all secrets');
        }
      });

    router
      .route('/secret-value/:secret')
      .get(requireScopes(SCOPES.secretsSettings.get), async (req, res) => {
        try {
          const workspaceId = getWorkspaceId(req);
          const secrets = await metadataStore.getSecrets(workspaceId);
          if (isHiddenSecretNameOrRef(secrets, req.params.secret)) {
            res.status(404).send({ message: 'Secret not found' });
            return;
          }
          const meta = findSecretByNameOrRef(secrets, req.params.secret);
          if (!meta) {
            res.status(404).send({ message: 'Secret not found' });
            return;
          }
          const { [meta.internalKeyName]: value } = await secretStore
            .resolver({ workspaceId })
            .resolve([meta.internalKeyName]);
          const createdAtByRef = await getCreatedAtByRef(
            secretStore,
            [meta.internalKeyName],
            workspaceId,
          );
          const lastModifiedByRef = await getLastModifiedByRef(
            secretStore,
            [meta.internalKeyName],
            workspaceId,
          );
          res.status(200).send({
            name: meta.name,
            description: meta.description,
            createdAt: createdAtByRef[meta.internalKeyName],
            lastModified: lastModifiedByRef[meta.internalKeyName],
            helpUrl: meta.helpUrl,
            isCustom: meta.isCustom,
            status: value !== undefined ? 'Available' : 'Not Set',
          });
        } catch (e: unknown) {
          logger.warn(
            `error fetching secret ${req.params.secret}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          res.status(500).send(`Error fetching secret ${req.params.secret}`);
        }
      });

    router
      .route('/secret-status/:ref')
      .get(requireScopes(SCOPES.secretsSettings.get), async (req, res) => {
        if (isHiddenSecretRef(req.params.ref)) {
          res.status(404).send({ message: 'Secret not found' });
          return;
        }
        const workspaceId = getWorkspaceId(req);
        const exists = await secretStore
          .writer({ workspaceId })
          .exists(req.params.ref);
        res.status(200).send({ ref: req.params.ref, exists });
      });

    router
      .route('/secret-value/:secret')
      .delete(
        requireScopes(SCOPES.secretsSettings.delete),
        async (req, res) => {
          try {
            const workspaceId = getWorkspaceId(req);
            const writer = secretStore.writer({ workspaceId });
            if (writer.readOnly) {
              res.status(405).send({
                message:
                  'Secret store is read-only; secrets are managed externally',
              });
              return;
            }
            const secrets = await metadataStore.getSecrets(workspaceId);
            if (isHiddenSecretNameOrRef(secrets, req.params.secret)) {
              res.status(404).send({ message: 'Secret not found' });
              return;
            }
            const meta = findSecretByNameOrRef(secrets, req.params.secret);
            if (!meta) {
              res.status(404).send({ message: 'Secret not found' });
              return;
            }
            await writer.delete(meta.internalKeyName);
            res.status(200).send();
          } catch (e: unknown) {
            logger.warn(
              `error deleting secret ${req.params.secret}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
            if (e instanceof SecretStoreReadOnlyError) {
              res.status(405).send({ message: e.message });
              return;
            }
            res.status(500).send(`Error deleting secret ${req.params.secret}`);
          }
        },
      );

    router
      .route('/keys')
      .post(
        requireScopes(SCOPES.secretsSettings.create),
        jsonParser,
        async (req, res) => {
          const body = req.body as { name?: string; value?: string };
          if (!body || !body.name || !body.value) {
            res
              .status(400)
              .send(
                'Invalid secret format. Expected "name" and "value" properties.',
              );
            return;
          }
          const workspaceId = getWorkspaceId(req);
          const writer = secretStore.writer({ workspaceId });
          if (writer.readOnly) {
            res.status(405).send({
              message:
                'Secret store is read-only; secrets must be configured externally',
            });
            return;
          }
          const allSecrets = await metadataStore.getSecrets(workspaceId);
          if (isHiddenSecretNameOrRef(allSecrets, body.name)) {
            res.status(403).send({
              message:
                'This secret is managed by Roadie in scoped mode and cannot be edited',
            });
            return;
          }
          const meta = findSecretByNameOrRef(allSecrets, body.name);
          if (!meta) {
            res
              .status(400)
              .send(
                `secret with name ${body.name} not found in configuration.`,
              );
            return;
          }
          try {
            await writer.put(meta.internalKeyName, body.value.trim());
            res.status(201).send({ newVersion: 1 });
          } catch (e: unknown) {
            logger.error(
              `error setting secret ${body.name}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
            if (e instanceof SecretStoreReadOnlyError) {
              res.status(405).send({ message: e.message });
              return;
            }
            if (e instanceof SecretStoreNotProvisionedError) {
              res.status(503).send({ message: e.message });
              return;
            }
            // Raw errors carry operator-only detail (KMS, tenant registry);
            // they are logged above and must not reach the client.
            res.status(503).send({
              message: `Failed to save secret "${body.name}". Please try again, or contact support if the problem persists.`,
            });
          }
        },
      );

    router
      .route('/bootstrap-secrets/sync')
      .post(jsonParser, async (req, res) => {
        const current = secretStore.info();
        if (current.mode !== 'scoped') {
          res.status(409).send({
            message:
              'Bootstrap secret sync is only available when the secret store is in scoped mode',
          });
          return;
        }

        const writer = secretStore.writer({
          workspaceId: getWorkspaceId(req),
        });
        if (writer.readOnly) {
          res.status(405).send({
            message:
              'Secret store is read-only; secrets are managed externally',
          });
          return;
        }

        try {
          await bootstrapSecretsSyncAuthorizer.authorize({
            authorizationHeader:
              typeof req.headers.authorization === 'string'
                ? req.headers.authorization
                : undefined,
          });
        } catch (e: unknown) {
          if (e instanceof BootstrapSecretsSyncAuthorizationError) {
            res.status(e.statusCode).send({ message: e.message });
            return;
          }
          throw e;
        }

        const body = (req.body ?? {}) as {
          overwriteExisting?: boolean;
          refs?: string[];
        };
        if (body.refs !== undefined) {
          if (
            !Array.isArray(body.refs) ||
            body.refs.some(ref => typeof ref !== 'string' || ref.length === 0)
          ) {
            res.status(400).send({
              message:
                'Invalid bootstrap sync request. Expected "refs" to be an array of non-empty strings.',
            });
            return;
          }
        }

        let bootstrapSecrets: Record<string, string>;
        try {
          bootstrapSecrets = await bootstrapSecretsLoader();
        } catch (e: unknown) {
          logger.warn(
            `error loading bootstrap secrets: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          res.status(503).send({
            message: 'Error loading bootstrap secrets',
          });
          return;
        }

        if (Object.keys(bootstrapSecrets).length === 0) {
          res.status(503).send({
            message: 'Bootstrap secrets are not configured',
          });
          return;
        }

        const bootstrapMap = new Map(Object.entries(bootstrapSecrets));
        const refs = body.refs ?? Array.from(bootstrapMap.keys());
        const unknownRefs = refs.filter(ref => !bootstrapMap.has(ref));
        if (unknownRefs.length > 0) {
          res.status(400).send({
            message: `Unknown bootstrap secret refs: ${unknownRefs.join(', ')}`,
          });
          return;
        }

        const seededRefs: string[] = [];
        const skippedRefs: string[] = [];
        try {
          for (const ref of refs) {
            const value = bootstrapMap.get(ref);
            if (value === undefined) {
              continue;
            }
            if (!body.overwriteExisting && (await writer.exists(ref))) {
              skippedRefs.push(ref);
              continue;
            }
            await writer.put(ref, value);
            seededRefs.push(ref);
          }
        } catch (e: unknown) {
          logger.warn(
            `error syncing bootstrap secrets: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          if (e instanceof SecretStoreReadOnlyError) {
            res.status(405).send({ message: e.message });
            return;
          }
          res.status(503).send({
            message: 'Error syncing bootstrap secrets',
          });
          return;
        }

        res.status(200).send({
          seededRefs,
          skippedRefs,
        });
      });

    router
      .route('/secret-metadata')
      .post(
        requireScopes(SCOPES.secretsSettings.create),
        jsonParser,
        async (req, res) => {
          const secretMetadata = req.body as SecretMetadata;
          if (!secretMetadata.name) {
            res.status(400).send('Secret must have a unique "name" property');
            return;
          }
          const proposed: SecretMetadata = {
            ...secretMetadata,
            internalKeyName:
              secretMetadata.internalKeyName || secretMetadata.name,
          };
          if (isHiddenSecretRef(proposed.internalKeyName)) {
            res.status(403).send({
              message:
                'This secret is managed by Roadie in scoped mode and cannot be edited',
            });
            return;
          }
          const workspaceId = getWorkspaceId(req);
          const existing = await metadataStore.getSecrets(workspaceId);
          if (existing.some(s => s.name === proposed.name)) {
            res
              .status(400)
              .send(`A secret with name "${proposed.name}" already exists`);
            return;
          }
          if (
            existing.some(s => s.internalKeyName === proposed.internalKeyName)
          ) {
            res
              .status(400)
              .send(
                `A secret with internalKeyName "${proposed.internalKeyName}" already exists`,
              );
            return;
          }
          try {
            await metadataStore.addSecret(proposed, workspaceId);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`error creating secret metadata: ${msg}`);
            res.status(500).send('Error creating secret metadata');
            return;
          }
          res.status(201).send();
        },
      );

    router
      .route('/secret-metadata/:name')
      .patch(
        requireScopes(SCOPES.secretsSettings.create),
        jsonParser,
        async (req, res) => {
          const name = req.params.name;
          const patch = req.body as Partial<SecretMetadata> & {
            internalKeyName?: string;
          };
          const workspaceId = getWorkspaceId(req);
          const existing = await metadataStore.getSecrets(workspaceId);
          const matched = findSecretByNameOrRef(existing, name);
          if (matched && !matched.isCustom) {
            res.status(403).send({
              message: 'Default secret metadata cannot be edited',
            });
            return;
          }
          if (
            matched &&
            patch.name !== undefined &&
            existing.some(
              secret => secret !== matched && secret.name === patch.name,
            )
          ) {
            res
              .status(400)
              .send(`A secret with name "${patch.name}" already exists`);
            return;
          }
          if (
            matched &&
            patch.internalKeyName !== undefined &&
            existing.some(
              secret =>
                secret !== matched &&
                secret.internalKeyName === patch.internalKeyName,
            )
          ) {
            res
              .status(400)
              .send(
                `A secret with internalKeyName "${patch.internalKeyName}" already exists`,
              );
            return;
          }
          if (
            isHiddenSecretNameOrRef(existing, name) ||
            (patch.internalKeyName !== undefined &&
              isHiddenSecretRef(patch.internalKeyName))
          ) {
            res.status(403).send({
              message:
                'This secret is managed by Roadie in scoped mode and cannot be edited',
            });
            return;
          }
          try {
            await metadataStore.edit(
              name,
              {
                description: patch.description,
                helpUrl: patch.helpUrl,
                name: patch.name,
                internalKeyName: patch.internalKeyName,
              },
              workspaceId,
            );
            res.status(200).send();
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`error editing secret metadata: ${msg}`);
            res.status(500).send('Error editing secret metadata');
          }
        },
      )
      .delete(
        requireScopes(SCOPES.secretsSettings.delete),
        async (req, res) => {
          const name = req.params.name;
          const workspaceId = getWorkspaceId(req);
          const existing = await metadataStore.getSecrets(workspaceId);
          const matched = findSecretByNameOrRef(existing, name);
          if (matched && !matched.isCustom) {
            res.status(403).send({
              message: 'Default secret metadata cannot be deleted',
            });
            return;
          }
          if (isHiddenSecretNameOrRef(existing, name)) {
            res.status(403).send({
              message:
                'This secret is managed by Roadie in scoped mode and cannot be edited',
            });
            return;
          }
          try {
            await metadataStore.delete(name, workspaceId);
            res.status(200).send();
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`error deleting secret metadata: ${msg}`);
            res.status(500).send('Error deleting secret metadata');
          }
        },
      );

    logger.info(
      `secrets-settings plugin initialized with storage mode "${info.mode}" (readOnly=${info.readOnly})`,
    );

    void events;
    void httpAuth;

    return router;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(
      `Secrets Settings plugin configured incorrectly: ${msg}. Defaulting to empty router.`,
    );
    const router = Router();
    router.use((_req, res) =>
      res.status(501).send('secrets-settings plugin configured incorrectly'),
    );
    return router;
  }
}

function loadConfiguredSecrets(config: Config): SecretMetadata[] {
  const arr = config.getOptionalConfigArray('secrets');
  if (!arr) {
    return [];
  }
  return arr.map(c => ({
    name: c.getString('name'),
    internalKeyName: c.getString('internalName'),
    description: c.getOptionalString('description') ?? undefined,
    helpUrl: c.getOptionalString('helpUrl') ?? undefined,
    isCustom: false,
  }));
}

async function getLastModifiedByRef(
  secretStore: SecretStoreService,
  refs: string[],
  workspaceId: string,
): Promise<Record<string, string>> {
  if (refs.length === 0) {
    return {};
  }

  if (secretStore.getLastModified) {
    return secretStore.getLastModified(refs, { workspaceId });
  }

  const info = secretStore.info();
  if (info.mode !== 'dotenv' || !info.dotenvPath) {
    return {};
  }

  try {
    const { mtime } = await stat(info.dotenvPath);
    const lastModified = mtime.toISOString();
    return Object.fromEntries(refs.map(ref => [ref, lastModified]));
  } catch {
    return {};
  }
}

async function getCreatedAtByRef(
  secretStore: SecretStoreService,
  refs: string[],
  workspaceId: string,
): Promise<Record<string, string>> {
  if (refs.length === 0) {
    return {};
  }

  if (secretStore.getCreatedAt) {
    return secretStore.getCreatedAt(refs, { workspaceId });
  }

  const info = secretStore.info();
  if (info.mode !== 'dotenv' || !info.dotenvPath) {
    return {};
  }

  try {
    const { birthtime } = await stat(info.dotenvPath);
    const createdAt = birthtime.toISOString();
    return Object.fromEntries(refs.map(ref => [ref, createdAt]));
  } catch {
    return {};
  }
}
