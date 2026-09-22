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

import { Knex } from 'knex';
import { v4 as uuid, validate as isUuid } from 'uuid';
import { DateTime } from 'luxon';
import { NotFoundError, ConflictError } from '@roadiehq/errors';
import { LoggerService } from '@roadiehq/extensions-api';
import { Config } from '@roadiehq/config';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import type { SecretsMetadataService } from '@roadiehq/secrets-settings-backend';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';
import { extractSecretRefs } from '@roadiehq/secrets-node';
import { buildEnvVarAllowList } from '../utils/envVarAllowList';
import { getLogoSlugBySvg } from '../logos';
import { getIntegrationReadinessError } from '../service/integrationReadiness';
import {
  IntegrationRow,
  Integration,
  CreateIntegrationInput,
  UpdateIntegrationInput,
  AuthConfig,
  HeaderAuthConfig,
  BasicAuthConfig,
  BearerTokenAuthConfig,
  OAuth2ClientCredentialsAuthConfig,
  OAuth2JwtBearerAuthConfig,
  IntegrationType,
  AuthType,
  BackendType,
  GithubAppInfo,
} from './types';
import { GithubAppDao, GithubAppRow } from './GithubAppDao';
import { GithubAppInstallationDao } from './GithubAppInstallationDao';

const TABLE_NAME = 'integrations';

/**
 * Returns true if every `${REF}` in `value` is in the caller's allowList.
 * This is the "configured" half of readiness: we validate that the
 * integration's declared refs are all declared in
 * `secretsSettings.secrets`, without asking any secret store whether the
 * values are actually present.
 */
function refsAllAllowed(
  value: string | null | undefined,
  allowList: Set<string>,
): boolean {
  if (!value) {
    return true;
  }
  const refs = extractSecretRefs(value);
  return refs.every(ref => allowList.has(ref));
}

function collectAuthRefs(authType: string, authConfig: AuthConfig): string[] {
  const strings: Array<string | null | undefined> = [];
  if (authType === 'header' && authConfig && 'headers' in authConfig) {
    for (const v of Object.values((authConfig as HeaderAuthConfig).headers)) {
      if (typeof v === 'string') {
        strings.push(v);
      }
    }
  } else if (authType === 'basic' && authConfig && 'password' in authConfig) {
    const { username, password } = authConfig as BasicAuthConfig;
    strings.push(username, password);
  } else if (
    authType === 'bearer-token' &&
    authConfig &&
    'token' in authConfig
  ) {
    strings.push((authConfig as BearerTokenAuthConfig).token);
  } else if (
    authType === 'oauth2-client-credentials' &&
    authConfig &&
    'clientId' in authConfig
  ) {
    const c = authConfig as OAuth2ClientCredentialsAuthConfig;
    strings.push(c.clientId, c.clientSecret, c.tokenUrl, c.audience, c.scope);
  } else if (
    authType === 'oauth2-jwt-bearer' &&
    authConfig &&
    'issuer' in authConfig
  ) {
    const c = authConfig as OAuth2JwtBearerAuthConfig;
    strings.push(
      c.issuer,
      c.privateKey,
      c.tokenUrl,
      c.audience,
      c.scope,
      c.subject,
    );
  }
  const refs = new Set<string>();
  for (const s of strings) {
    if (typeof s === 'string') {
      for (const ref of extractSecretRefs(s)) {
        refs.add(ref);
      }
    }
  }
  return [...refs];
}

function isAuthConfigured(
  authType: string,
  authConfig: AuthConfig,
  allowList: Set<string>,
  logger?: LoggerService,
  integrationName?: string,
): boolean {
  const log = (msg: string) => {
    logger?.debug(`Integration "${integrationName}" is not ready: ${msg}`);
  };

  if (authType === 'none') {
    return true;
  }
  if (authType === 'github-app') {
    return false;
  }

  const refs = collectAuthRefs(authType, authConfig);
  const disallowed = refs.filter(ref => !allowList.has(ref));
  if (disallowed.length > 0) {
    log(`references undeclared secrets: ${disallowed.join(', ')}`);
    return false;
  }

  if (authType === 'header') {
    if (!authConfig || !('headers' in authConfig)) {
      log('authType is "header" but authConfig is missing or has no headers');
      return false;
    }
    return true;
  }
  if (authType === 'basic') {
    if (!authConfig || !('password' in authConfig)) {
      log('authType is "basic" but authConfig is missing or has no password');
      return false;
    }
    return refsAllAllowed((authConfig as BasicAuthConfig).password, allowList);
  }
  if (authType === 'bearer-token') {
    if (!authConfig || !('token' in authConfig)) {
      log(
        'authType is "bearer-token" but authConfig is missing or has no token',
      );
      return false;
    }
    return true;
  }
  if (authType === 'oauth2-client-credentials') {
    if (!authConfig || !('clientId' in authConfig)) {
      log(
        'authType is "oauth2-client-credentials" but authConfig is missing or has no clientId',
      );
      return false;
    }
    return true;
  }
  if (authType === 'oauth2-jwt-bearer') {
    if (!authConfig || !('issuer' in authConfig)) {
      log(
        'authType is "oauth2-jwt-bearer" but authConfig is missing or has no issuer',
      );
      return false;
    }
    return true;
  }
  return true;
}

function isGithubAppConfigured(
  githubApp: GithubAppInfo | undefined,
  allowList: Set<string>,
): boolean {
  if (!githubApp) {
    return false;
  }
  if (githubApp.kmsKeyId) {
    return true;
  }
  return !!githubApp.privateKeyRef && allowList.has(githubApp.privateKeyRef);
}

function parseAuthConfig(raw: unknown): AuthConfig {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  if ('headers' in raw) {
    return raw as HeaderAuthConfig;
  }
  if ('issuer' in raw && 'privateKey' in raw) {
    return raw as OAuth2JwtBearerAuthConfig;
  }
  if ('serviceAccountEmail' in raw && 'privateKey' in raw) {
    const legacy = raw as {
      serviceAccountEmail: string;
      privateKey: string;
      tokenUrl: string;
      scope?: string;
      delegatedSubject?: string;
    };
    return {
      issuer: legacy.serviceAccountEmail,
      privateKey: legacy.privateKey,
      tokenUrl: legacy.tokenUrl,
      scope: legacy.scope,
      subject: legacy.delegatedSubject,
    };
  }
  if ('clientId' in raw && 'tokenUrl' in raw) {
    return raw as OAuth2ClientCredentialsAuthConfig;
  }
  if ('password' in raw) {
    return raw as BasicAuthConfig;
  }
  if ('token' in raw) {
    return raw as BearerTokenAuthConfig;
  }
  return raw as Record<string, unknown>;
}

function githubAppRowToInfo(row: GithubAppRow): GithubAppInfo {
  const purposesRaw = row.purposes;
  let purposes: string[] | undefined;

  if (Array.isArray(purposesRaw)) {
    purposes = purposesRaw.filter(
      (value): value is string => typeof value === 'string',
    );
  } else if (typeof purposesRaw === 'string') {
    try {
      const parsed = JSON.parse(purposesRaw);
      if (Array.isArray(parsed)) {
        purposes = parsed.filter(
          (value): value is string => typeof value === 'string',
        );
      }
    } catch {
      purposes = undefined;
    }
  }

  return {
    appId: row.app_id,
    host: row.host,
    purposes,
    slug: row.slug ?? undefined,
    htmlUrl: row.html_url ?? undefined,
    description: row.description ?? undefined,
    privateKeyRef: row.private_key_ref ?? undefined,
    clientSecretRef: row.client_secret_ref ?? undefined,
    kmsKeyId: row.kms_key_id ?? undefined,
  };
}

function rowToIntegration(
  row: IntegrationRow,
  githubApps: GithubAppInfo[],
): Integration {
  const config: Record<string, unknown> = (row.config ?? {}) as Record<
    string,
    unknown
  >;

  const authConfig = parseAuthConfig(row.auth_config);

  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id),
    name: row.name,
    slug: row.slug,
    type: row.type as IntegrationType,
    host: row.host,
    authType: row.auth_type as AuthType,
    authConfig,
    requestsPerHour: row.requests_per_hour,
    requestsPerSecond: row.requests_per_second ?? undefined,
    burstCapacity: row.burst_capacity ?? undefined,
    backendType: (row.backend_type ?? 'http') as BackendType,
    config,
    createdBy: row.created_by,
    createdAt: DateTime.fromJSDate(row.created_at).toISO()!,
    updatedAt: DateTime.fromJSDate(row.updated_at).toISO()!,
    logoSvg: row.logo_svg ?? undefined,
    logoSlug: row.logo_svg ? getLogoSlugBySvg(row.logo_svg) : undefined,
    graphqlPath: row.graphql_path ?? null,
    extensions: githubApps.length > 0 ? { githubApps } : undefined,
  };
}

function collectIntegrationRefs(
  integration: Integration,
  githubApps: GithubAppInfo[],
): string[] {
  const refs = new Set<string>(
    collectAuthRefs(integration.authType, integration.authConfig),
  );
  for (const app of githubApps) {
    if (app.privateKeyRef) {
      refs.add(app.privateKeyRef);
    }
  }
  return [...refs];
}

export class IntegrationDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;
  private readonly envVarAllowList: Set<string>;
  private readonly secretStore?: SecretStoreService;
  private readonly secretsMetadataService?: SecretsMetadataService;
  private readonly githubAppDao?: GithubAppDao;
  private readonly githubAppInstallationDao?: GithubAppInstallationDao;

  constructor(options: {
    knex: Knex;
    logger: LoggerService;
    config: Config;
    secretStore?: SecretStoreService;
    secretsMetadataService?: SecretsMetadataService;
    githubAppDao?: GithubAppDao;
    githubAppInstallationDao?: GithubAppInstallationDao;
  }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'IntegrationDao' });
    this.envVarAllowList = new Set(
      buildEnvVarAllowList(options.config, this.logger),
    );
    this.secretStore = options.secretStore;
    this.secretsMetadataService = options.secretsMetadataService;
    this.githubAppDao = options.githubAppDao;
    this.githubAppInstallationDao = options.githubAppInstallationDao;
  }

  private isConfiguredForExecution(
    integration: Integration,
    allowList: Set<string>,
  ): boolean {
    const githubApps = integration.extensions?.githubApps ?? [];
    const authConfigured = isAuthConfigured(
      integration.authType,
      integration.authConfig,
      allowList,
      this.logger,
      integration.name,
    );
    const githubAppConfigured = githubApps.some(app =>
      isGithubAppConfigured(app, allowList),
    );
    if (integration.authType === 'github-app') {
      return githubAppConfigured;
    }
    return authConfigured || githubAppConfigured;
  }

  private async isMechanismReady(integration: Integration): Promise<boolean> {
    const error = await getIntegrationReadinessError(integration, {
      githubAppDao: this.githubAppDao,
      githubAppInstallationDao: this.githubAppInstallationDao,
    });
    return error === undefined;
  }

  async isReadyForCurrentScope(
    integration: Integration,
    allowList: Set<string>,
  ): Promise<boolean> {
    if (!this.isConfiguredForExecution(integration, allowList)) {
      return false;
    }
    if (!(await this.isMechanismReady(integration))) {
      return false;
    }
    const githubApps = integration.extensions?.githubApps ?? [];
    const refs = collectIntegrationRefs(integration, githubApps);
    if (refs.length === 0) {
      return true;
    }
    if (!this.secretStore) {
      return true;
    }
    const resolved = await this.secretStore
      .resolver({ workspaceId: integration.workspaceId })
      .resolve(refs);
    return refs.every(ref => typeof resolved[ref] === 'string');
  }

  private async withReadyForCurrentScope(
    integrations: Integration[],
    allowList: Set<string>,
  ): Promise<Integration[]> {
    const pending: Array<{ integration: Integration; refs: string[] }> = [];

    for (const integration of integrations) {
      if (!this.isConfiguredForExecution(integration, allowList)) {
        integration.readyForCurrentScope = false;
        continue;
      }

      if (!(await this.isMechanismReady(integration))) {
        integration.readyForCurrentScope = false;
        continue;
      }

      const refs = collectIntegrationRefs(
        integration,
        integration.extensions?.githubApps ?? [],
      );

      if (refs.length === 0 || !this.secretStore) {
        integration.readyForCurrentScope = true;
        continue;
      }

      integration.readyForCurrentScope = false;
      pending.push({ integration, refs });
    }

    if (pending.length === 0) {
      return integrations;
    }

    const byWorkspace = new Map<
      string | undefined,
      Array<{ integration: Integration; refs: string[] }>
    >();
    for (const entry of pending) {
      const workspaceId = entry.integration.workspaceId;
      byWorkspace.set(workspaceId, [
        ...(byWorkspace.get(workspaceId) ?? []),
        entry,
      ]);
    }
    for (const [workspaceId, entries] of byWorkspace) {
      const refs = [...new Set(entries.flatMap(entry => entry.refs))];
      const resolved = await this.secretStore!.resolver({
        workspaceId,
      }).resolve(refs);
      for (const entry of entries) {
        entry.integration.readyForCurrentScope = entry.refs.every(
          ref => typeof resolved[ref] === 'string',
        );
      }
    }

    return integrations;
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<IntegrationRow>(TABLE_NAME);
  }

  private selectBase(trx?: Knex) {
    return this.table(trx);
  }

  async getWorkspaceIdById(id: string): Promise<string | undefined> {
    const row = await this.table().select('workspace_id').where({ id }).first();
    return row?.workspace_id;
  }

  private async fetchAppsForIds(
    integrationIds: string[],
    trx?: Knex,
  ): Promise<Map<string, GithubAppInfo[]>> {
    if (integrationIds.length === 0) {
      return new Map();
    }
    const appRows = await (trx || this.knex)<GithubAppRow>('github_apps')
      .whereIn('integration_id', integrationIds)
      .where('status', 'active')
      .orderBy('updated_at', 'desc');
    const map = new Map<string, GithubAppInfo[]>();
    for (const appRow of appRows) {
      if (!appRow.integration_id) {
        continue;
      }
      const list = map.get(appRow.integration_id) ?? [];
      list.push(githubAppRowToInfo(appRow));
      map.set(appRow.integration_id, list);
    }
    return map;
  }

  private async getEnvVarAllowList(workspaceId?: string): Promise<Set<string>> {
    const metadataNames =
      (await this.secretsMetadataService?.getSecretInternalNames(
        workspaceId,
      )) ?? [];
    return new Set([...this.envVarAllowList, ...metadataNames]);
  }

  async list(options?: {
    type?: string;
    search?: string;
    limit?: number;
    offset?: number;
    /**
     * Restrict to integrations the caller may see, by slug or id. `undefined`
     * means no restriction; an empty list matches nothing.
     */
    allowedIdentifiers?: string[];
    workspaceId?: string;
  }): Promise<{ integrations: Integration[]; total: number }> {
    const {
      type,
      search,
      limit = 50,
      offset = 0,
      allowedIdentifiers,
      workspaceId = DEFAULT_WORKSPACE_ID,
    } = options ?? {};

    let query = this.selectBase().where('workspace_id', workspaceId);

    if (type !== undefined) {
      query = query.where('type', type);
    }

    if (search) {
      const sanitized = search.replace(/[%_\\]/g, '\\$&');
      query = query.where(builder => {
        builder
          .whereILike('name', `%${sanitized}%`)
          .orWhereILike('slug', `%${sanitized}%`)
          .orWhereILike('host', `%${sanitized}%`);
      });
    }

    if (allowedIdentifiers) {
      // Match by slug (text) or id, passing only uuids to the id column.
      const ids = allowedIdentifiers.filter(isUuid);
      query = query.where(builder => {
        builder.whereIn('slug', allowedIdentifiers);
        if (ids.length) {
          builder.orWhereIn('id', ids);
        }
      });
    }

    // id breaks updated_at ties, so repeated listings return the same order.
    // This query is unpaged, but a caller diffing two listings still needs the
    // order to be stable between them.
    const rows = await query.orderBy([
      { column: 'updated_at', order: 'desc' },
      { column: 'id', order: 'desc' },
    ]);
    const allowList = await this.getEnvVarAllowList(workspaceId);
    const appsMap = await this.fetchAppsForIds(rows.map(r => r.id));
    const integrations = await this.withReadyForCurrentScope(
      rows.map(row => rowToIntegration(row, appsMap.get(row.id) ?? [])),
      allowList,
    );

    const total = integrations.length;
    const paginated = integrations.slice(offset, offset + limit);

    return {
      integrations: paginated,
      total,
    };
  }

  async getById(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Integration> {
    const row = await this.selectBase()
      .where({ id, workspace_id: workspaceId })
      .first();

    if (!row) {
      throw new NotFoundError(`Integration not found: ${id}`);
    }

    const allowList = await this.getEnvVarAllowList(workspaceId);
    const appsMap = await this.fetchAppsForIds([id]);
    const [integration] = await this.withReadyForCurrentScope(
      [rowToIntegration(row, appsMap.get(id) ?? [])],
      allowList,
    );
    return integration;
  }

  async getByIdOrSlug(
    idOrSlug: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Integration> {
    const allowList = await this.getEnvVarAllowList(workspaceId);
    let row: IntegrationRow | undefined;

    if (isUuid(idOrSlug)) {
      row = await this.selectBase()
        .where({ id: idOrSlug, workspace_id: workspaceId })
        .first();
    }

    if (!row) {
      row = await this.selectBase()
        .where({ slug: idOrSlug, workspace_id: workspaceId })
        .first();
    }

    if (!row) {
      throw new NotFoundError(`Integration not found: ${idOrSlug}`);
    }

    const appsMap = await this.fetchAppsForIds([row.id]);
    const [integration] = await this.withReadyForCurrentScope(
      [rowToIntegration(row, appsMap.get(row.id) ?? [])],
      allowList,
    );
    return integration;
  }

  async getByName(
    name: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Integration | undefined> {
    const row = await this.selectBase()
      .where({ name, workspace_id: workspaceId })
      .first();
    if (!row) {
      return undefined;
    }
    const allowList = await this.getEnvVarAllowList(workspaceId);
    const appsMap = await this.fetchAppsForIds([row.id]);
    const [integration] = await this.withReadyForCurrentScope(
      [rowToIntegration(row, appsMap.get(row.id) ?? [])],
      allowList,
    );
    return integration;
  }

  async getBySlug(
    slug: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Integration | undefined> {
    const row = await this.selectBase()
      .where({ slug, workspace_id: workspaceId })
      .first();
    if (!row) {
      return undefined;
    }
    const allowList = await this.getEnvVarAllowList(workspaceId);
    const appsMap = await this.fetchAppsForIds([row.id]);
    const [integration] = await this.withReadyForCurrentScope(
      [rowToIntegration(row, appsMap.get(row.id) ?? [])],
      allowList,
    );
    return integration;
  }

  async getLogoById(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<string | null> {
    const row = await this.table()
      .select('logo_svg')
      .where({ id, workspace_id: workspaceId })
      .first();

    if (!row) {
      throw new NotFoundError(`Integration not found: ${id}`);
    }

    return row.logo_svg;
  }

  async create(
    input: CreateIntegrationInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Integration> {
    const id = uuid();
    const now = new Date();
    const existing = await this.getBySlug(input.slug, workspaceId);
    if (existing) {
      throw new ConflictError(
        `Integration with slug "${input.slug}" already exists`,
      );
    }

    const row: IntegrationRow = {
      id,
      workspace_id: workspaceId,
      name: input.name,
      slug: input.slug,
      type: input.type,
      host: input.host.replace(/\/$/, ''),
      auth_type: input.authType ?? 'none',
      auth_config: input.authConfig ? JSON.stringify(input.authConfig) : null,
      requests_per_hour: input.requestsPerHour ?? 36000,
      requests_per_second: input.requestsPerSecond ?? null,
      burst_capacity: input.burstCapacity ?? null,
      backend_type: input.backendType ?? 'http',
      config: JSON.stringify(input.config ?? {}),
      logo_svg: input.logoSvg ?? null,
      graphql_path: input.graphqlPath ?? null,
      created_by: input.createdBy,
      created_at: now,
      updated_at: now,
    };

    await this.table().insert(row);
    this.logger.info(`Created integration: ${input.name} (${id})`);

    return this.getById(id, workspaceId);
  }

  async update(
    id: string,
    input: UpdateIntegrationInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Integration> {
    const allowList = await this.getEnvVarAllowList(workspaceId);
    return this.knex.transaction(async trx => {
      const lockedRow = await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .forUpdate()
        .first();

      if (!lockedRow) {
        throw new NotFoundError(`Integration not found: ${id}`);
      }

      const row = await this.selectBase(trx)
        .where({ id, workspace_id: workspaceId })
        .first();

      if (!row) {
        throw new NotFoundError(`Integration not found: ${id}`);
      }

      const appsMap = await this.fetchAppsForIds([id], trx);
      const existing = rowToIntegration(row, appsMap.get(id) ?? []);

      if (input.slug && input.slug !== existing.slug) {
        const slugConflict = await this.table(trx)
          .where({ slug: input.slug, workspace_id: workspaceId })
          .first();
        if (slugConflict) {
          throw new ConflictError(
            `Integration with slug "${input.slug}" already exists`,
          );
        }
      }

      const updates: Partial<IntegrationRow> = {
        updated_at: new Date(),
      };

      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (input.slug !== undefined) {
        updates.slug = input.slug;
      }
      if (input.type !== undefined) {
        updates.type = input.type;
      }
      if (input.host !== undefined) {
        updates.host = input.host.replace(/\/$/, '');
      }
      if (input.authType !== undefined) {
        updates.auth_type = input.authType;
      }
      if (input.authConfig !== undefined) {
        updates.auth_config = input.authConfig
          ? JSON.stringify(input.authConfig)
          : null;
      }
      if (input.requestsPerHour !== undefined) {
        updates.requests_per_hour = input.requestsPerHour;
      }
      if (input.requestsPerSecond !== undefined) {
        updates.requests_per_second = input.requestsPerSecond;
      }
      if (input.burstCapacity !== undefined) {
        updates.burst_capacity = input.burstCapacity;
      }
      if (input.backendType !== undefined) {
        updates.backend_type = input.backendType;
      }
      if (input.config !== undefined) {
        updates.config = JSON.stringify(input.config);
      }
      if (input.logoSvg !== undefined) {
        updates.logo_svg = input.logoSvg;
      }
      if (input.graphqlPath !== undefined) {
        updates.graphql_path = input.graphqlPath;
      }

      await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .update(updates);
      this.logger.info(`Updated integration: ${existing.name} (${id})`);

      const updated = await this.selectBase(trx)
        .where({ id, workspace_id: workspaceId })
        .first();
      const updatedAppsMap = await this.fetchAppsForIds([id], trx);
      const [integration] = await this.withReadyForCurrentScope(
        [rowToIntegration(updated!, updatedAppsMap.get(id) ?? [])],
        allowList,
      );
      return integration;
    });
  }

  async delete(id: string, workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
    const integration = await this.getById(id, workspaceId);
    await this.table().where({ id, workspace_id: workspaceId }).delete();
    this.logger.info(`Deleted integration: ${integration.name} (${id})`);
  }
}
