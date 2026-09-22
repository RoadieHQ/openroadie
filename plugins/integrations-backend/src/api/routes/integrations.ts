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

import Router from 'express-promise-router';
import express from 'express';
import { LoggerService } from '@roadiehq/extensions-api';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import { IntegrationDao } from '../../database';
import {
  IntegrationClient,
  HttpRequestOptions,
  AwsOrganizationsAccountPreviewOptions,
  AwsTrustSetupOptions,
} from '@roadiehq/integrations-node';
import { z } from 'zod';
import { SCOPES, resolveAllowedTargets } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import { GithubAppDao, GithubAppInstallationDao } from '../../database';
import { getLogoList, getLogoSvg } from '../../logos';
import type {
  IntegrationUsageRef,
  IntegrationUsageService,
} from '../../service/IntegrationUsageService';
import {
  getIntegrationConfigurationError,
  getIntegrationReadinessError,
} from '../../service/integrationReadiness';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

export interface IntegrationsRouterOptions {
  logger: LoggerService;
  integrationDao: IntegrationDao;
  integrationClient: IntegrationClient;
  getUserId: (req: express.Request) => Promise<string | undefined>;
  /**
   * Optional scope id injected into outbound integration requests. Used
   * by `integrations-node` backends as a cache discriminator; in
   * segmented deployments overlays can supply a resolver that returns
   * the current scope id so per-scope caches remain isolated.
   */
  getOptionalScopeId?: (req: express.Request) => string | undefined;
  githubAppDao?: GithubAppDao;
  githubAppInstallationDao?: GithubAppInstallationDao;
  secretStore?: SecretStoreService;
  scopeService: ScopeService;
  /**
   * Cross-plugin lookup backing the delete guard. Optional so a backend that
   * mounts integrations without the referencing plugins still works — when
   * absent, delete behaves as it did before the guard.
   */
  integrationUsage?: IntegrationUsageService;
  getWorkspaceId?: (req: express.Request) => string | undefined;
}

const USAGE_KIND_LABEL = {
  'data-source': 'data source',
  action: 'action',
  'relationship-rule': 'relationship rule',
} as const;

/** `data source "GitHub", action "Create Issue" and 2 more` */
function describeUsage(references: IntegrationUsageRef[]): string {
  const visible = references.slice(0, 3);
  const described = visible
    .map(ref => `${USAGE_KIND_LABEL[ref.kind]} "${ref.name}"`)
    .join(', ');
  const hidden = references.length - visible.length;
  return hidden > 0 ? `${described} and ${hidden} more` : described;
}

function parseNumericParam(
  value: unknown,
  name: string,
): { value?: number; error?: string } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string') {
    return { error: `${name} must be a string` };
  }
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    return { error: `${name} must be a non-negative integer` };
  }
  return { value: num };
}

const headerAuthConfigSchema = z.object({
  headers: z.record(z.string(), z.string()),
});

const basicAuthConfigSchema = z.object({
  username: z.string().optional(),
  password: z.string(),
});

const bearerTokenAuthConfigSchema = z.object({
  token: z.string(),
});

const oauth2ClientCredentialsAuthConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  tokenUrl: z.string(),
  audience: z.string().optional(),
  scope: z.string().optional(),
});

const oauth2JwtBearerAuthConfigSchema = z.object({
  issuer: z.string(),
  privateKey: z.string(),
  tokenUrl: z.string(),
  audience: z.string().optional(),
  scope: z.string().optional(),
  subject: z.string().optional(),
});

const editableAuthTypes = [
  'header',
  'basic',
  'bearer-token',
  'oauth2-client-credentials',
  'oauth2-jwt-bearer',
  'none',
] as const;

function isEditableAuthType(
  authType: string,
): authType is (typeof editableAuthTypes)[number] {
  return (editableAuthTypes as readonly string[]).includes(authType);
}

const authConfigSchema = z.union([
  headerAuthConfigSchema,
  basicAuthConfigSchema,
  bearerTokenAuthConfigSchema,
  oauth2ClientCredentialsAuthConfigSchema,
  oauth2JwtBearerAuthConfigSchema,
  z.record(z.string(), z.unknown()),
  z.null(),
  z.undefined(),
]);

const createIntegrationSchema = z
  .object({
    name: z.string().min(1, { message: 'name is required' }),
    slug: z.string().min(1, { message: 'slug is required' }),
    host: z.string().optional(),
    type: z
      .enum([
        'scm',
        'ci-cd',
        'monitoring',
        'incident-management',
        'infrastructure',
        'security',
        'communication',
        'project-management',
        'analytics',
        'other',
      ] as const)
      .default('other'),
    authType: z
      .string()
      .min(1, { message: 'authType is required' })
      .default('none'),
    authConfig: authConfigSchema.optional(),
    backendType: z.enum(['http', 'aws'] as const).default('http'),
    requestsPerHour: z
      .number()
      .positive({ message: 'requestsPerHour must be a positive number' })
      .optional(),
    requestsPerSecond: z
      .number()
      .positive({ message: 'requestsPerSecond must be a positive number' })
      .optional(),
    burstCapacity: z
      .number()
      .positive({ message: 'burstCapacity must be a positive number' })
      .optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    logoSlug: z.string().optional(),
    graphqlPath: z.string().optional().nullable(),
  })
  .refine(
    data => {
      if (data.backendType === 'aws') {
        return true;
      }
      return typeof data.host === 'string' && data.host.length > 0;
    },
    {
      message: 'host is required for HTTP integrations',
      path: ['host'],
    },
  )
  .refine(
    data => {
      if (!isEditableAuthType(data.authType)) {
        return true;
      }
      if (data.authType === 'none') {
        return data.authConfig === null || data.authConfig === undefined;
      }
      return data.authConfig !== null && data.authConfig !== undefined;
    },
    {
      message: 'authConfig is required for the selected authType',
      path: ['authConfig'],
    },
  );

const updateIntegrationSchema = z.object({
  name: z
    .string()
    .min(1, { message: 'name must be a non-empty string' })
    .optional(),
  slug: z
    .string()
    .min(1, { message: 'slug must be a non-empty string' })
    .optional(),
  type: z
    .enum([
      'scm',
      'ci-cd',
      'monitoring',
      'incident-management',
      'infrastructure',
      'security',
      'communication',
      'project-management',
      'analytics',
      'other',
    ] as const)
    .optional(),
  host: z.string().optional(),
  authType: z
    .string()
    .min(1, { message: 'authType must be a non-empty string' })
    .optional(),
  authConfig: authConfigSchema.optional(),
  backendType: z.enum(['http', 'aws'] as const).optional(),
  requestsPerHour: z
    .number()
    .positive({ message: 'requestsPerHour must be a positive number' })
    .optional(),
  requestsPerSecond: z
    .number()
    .positive({ message: 'requestsPerSecond must be a positive number' })
    .optional(),
  burstCapacity: z
    .number()
    .positive({ message: 'burstCapacity must be a positive number' })
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  logoSlug: z.string().optional().nullable(),
  graphqlPath: z.string().optional().nullable(),
});

const httpRequestSchema = z.object({
  backendType: z.literal('http'),
  path: z.string().min(1, { message: 'path is required' }),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)
    .default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

const awsResourceRequestSchema = z.object({
  backendType: z.literal('aws'),
  mode: z.literal('cloud-control').optional().default('cloud-control'),
  resourceType: z.string().min(1, { message: 'resourceType is required' }),
  accountId: z.string().min(1, { message: 'accountId is required' }),
  region: z.string().min(1, { message: 'region is required' }),
  operation: z.enum(['get', 'delete', 'update', 'create'] as const).optional(),
  identifier: z.string().optional(),
  desiredState: z.string().optional(),
  patchDocument: z.string().optional(),
});

const awsApiRequestSchema = z.object({
  backendType: z.literal('aws'),
  mode: z.literal('service-api').optional().default('service-api'),
  service: z.string().min(1, { message: 'service is required' }),
  profile: z.string().min(1, { message: 'profile is required' }),
  operation: z.string().optional(),
  region: z.string().min(1, { message: 'region is required' }),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)
    .default('POST'),
  path: z.string().min(1, { message: 'path is required' }),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

const integrationRequestSchema = z.union([
  httpRequestSchema,
  awsResourceRequestSchema,
  awsApiRequestSchema,
]);

const integrationProxyQuerySchema = z
  .object({
    path: z.string().min(1, { message: 'path is required' }),
  })
  .catchall(z.union([z.string(), z.array(z.string())]));

const DEFAULT_LOGO_SVG =
  '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#6b7280" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';

export function createIntegrationsRouter(
  options: IntegrationsRouterOptions,
): express.Router {
  const {
    logger,
    integrationDao,
    integrationClient,
    getUserId,
    getOptionalScopeId,
    githubAppDao,
    githubAppInstallationDao,
    secretStore,
    scopeService,
    integrationUsage,
    getWorkspaceId = () => undefined,
  } = options;

  const router = Router();
  const requireScopes = scopeService.requireScopes;
  const requireScopeFamily = scopeService.requireScopeFamily;

  router.get(
    '/logos',
    requireScopes(SCOPES.integration.query),
    async (_req, res) => {
      res.json({ logos: getLogoList() });
    },
  );

  router.get(
    '/logos/:slug',
    requireScopes(SCOPES.integration.get),
    async (req, res) => {
      const svg = getLogoSvg(req.params.slug);
      if (!svg) {
        res.status(404).json({ error: { message: 'Logo not found' } });
        return;
      }
      res
        .set('Content-Type', 'image/svg+xml')
        .set('Cache-Control', 'public, max-age=86400, immutable')
        .set('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(svg);
    },
  );

  // Admits the whole `integration:query` family; rows are then filtered to the
  // caller's granted targets (slug or id).
  router.get(
    '/',
    requireScopeFamily(SCOPES.integration.query),
    async (req, res) => {
      const type =
        typeof req.query.type === 'string' ? req.query.type : undefined;
      const search =
        typeof req.query.search === 'string' ? req.query.search : undefined;

      const limitResult = parseNumericParam(req.query.limit, 'limit');
      if (limitResult.error) {
        res.status(400).json({ error: { message: limitResult.error } });
        return;
      }

      const offsetResult = parseNumericParam(req.query.offset, 'offset');
      if (offsetResult.error) {
        res.status(400).json({ error: { message: offsetResult.error } });
        return;
      }

      const allowedIdentifiers = await resolveAllowedTargets(
        scopeService,
        req,
        SCOPES.integration.query,
      );

      const result = await integrationDao.list({
        type,
        search,
        limit: limitResult.value,
        offset: offsetResult.value,
        allowedIdentifiers,
        workspaceId: getWorkspaceId(req),
      });

      res.json({
        data: result.integrations,
        total: result.total,
        offset: offsetResult.value ?? 0,
        limit: limitResult.value ?? 50,
      });
    },
  );
  router.get(
    '/:id',
    requireScopes(SCOPES.integration.get),
    async (req, res) => {
      const integration = await integrationDao.getByIdOrSlug(
        req.params.id,
        getWorkspaceId(req),
      );
      res.json({ data: integration });
    },
  );

  router.get(
    '/:id/logo',
    requireScopes(SCOPES.integration.get),
    async (req, res) => {
      const logoSvg = await integrationDao.getLogoById(
        req.params.id,
        getWorkspaceId(req),
      );

      res
        .set('Content-Type', 'image/svg+xml')
        .set('Cache-Control', 'public, max-age=86400, immutable')
        .send(logoSvg || DEFAULT_LOGO_SVG);
    },
  );

  router.get(
    '/:id/proxy',
    requireScopes(SCOPES.integration.execute),
    async (req, res) => {
      const parsedQuery = integrationProxyQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        const issues = parsedQuery.error.issues
          .map(i =>
            i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message,
          )
          .join('; ');
        res.status(400).json({
          error: { message: `Invalid query: ${issues}` },
        });
        return;
      }

      const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      const integration = await integrationDao.getByIdOrSlug(
        req.params.id,
        workspaceId,
      );

      const configurationError = await getIntegrationConfigurationError(
        integration,
        {
          secretStore,
        },
      );
      if (configurationError) {
        res.status(400).json({
          error: {
            message: configurationError,
          },
        });
        return;
      }

      const scopeId = getOptionalScopeId?.(req);
      const readinessError = await getIntegrationReadinessError(integration, {
        githubAppDao,
        githubAppInstallationDao,
      });
      if (readinessError) {
        res.status(400).json({
          error: { message: readinessError },
        });
        return;
      }

      if (integration.backendType !== 'http') {
        res.status(400).json({
          error: {
            message: `Backend type mismatch: proxy route only supports http integrations but integration is ${integration.backendType}`,
          },
        });
        return;
      }

      const query = parsedQuery.data;
      const { path, ...restQuery } = query;
      const targetUrl = new URL(path, 'http://placeholder');
      for (const [key, value] of Object.entries(restQuery)) {
        if (!targetUrl.searchParams.has(key)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              targetUrl.searchParams.append(key, item);
            }
          } else {
            targetUrl.searchParams.append(key, value);
          }
        }
      }

      const requestOptions: HttpRequestOptions = {
        backendType: 'http',
        method: 'GET',
        path: `${targetUrl.pathname}${targetUrl.search}`,
        scopeId,
        workspaceId,
      };

      const data = await integrationClient.request(
        integration.id,
        requestOptions,
      );

      res.json({ data });
    },
  );

  router.post(
    '/:id/request',
    requireScopes(SCOPES.integration.execute),
    async (req, res) => {
      const result = integrationRequestSchema.safeParse(req.body);
      if (!result.success) {
        const issues = result.error.issues
          .map(i =>
            i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message,
          )
          .join('; ');
        res.status(400).json({
          error: { message: `Invalid request: ${issues}` },
        });
        return;
      }

      const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      const integration = await integrationDao.getByIdOrSlug(
        req.params.id,
        workspaceId,
      );

      const configurationError = await getIntegrationConfigurationError(
        integration,
        {
          secretStore,
        },
      );
      if (configurationError) {
        res.status(400).json({
          error: {
            message: configurationError,
          },
        });
        return;
      }

      const scopeId = getOptionalScopeId?.(req);
      const readinessError = await getIntegrationReadinessError(integration, {
        githubAppDao,
        githubAppInstallationDao,
      });
      if (readinessError) {
        res.status(400).json({
          error: { message: readinessError },
        });
        return;
      }

      const validatedBody = result.data;

      if (validatedBody.backendType !== integration.backendType) {
        res.status(400).json({
          error: {
            message: `Backend type mismatch: request is ${validatedBody.backendType} but integration is ${integration.backendType}`,
          },
        });
        return;
      }

      const data = await integrationClient.request(integration.id, {
        ...validatedBody,
        scopeId,
        workspaceId,
      });

      res.json({ data });
    },
  );

  // The values a customer must put in their cross-account trust policy. Read
  // off the assume-role policy, so this can't drift from what STS receives.
  // Deliberately does not run the readiness checks the preview route does: this
  // is what you need *before* the role exists, so it has to work on an
  // integration that cannot yet assume anything.
  router.get(
    '/:id/aws/trust-setup',
    requireScopes(SCOPES.integration.query),
    async (req, res) => {
      const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      const integration = await integrationDao.getByIdOrSlug(
        req.params.id,
        workspaceId,
      );

      if (!integration) {
        res.status(404).json({ error: { message: 'Integration not found' } });
        return;
      }

      if (integration.backendType !== 'aws') {
        res.status(400).json({
          error: {
            message: `Backend type mismatch: AWS trust setup only supports aws integrations but integration is ${integration.backendType}`,
          },
        });
        return;
      }

      try {
        const data = await integrationClient.request(integration.id, {
          backendType: 'aws',
          requestKind: 'trust-setup',
          scopeId: getOptionalScopeId?.(req),
          workspaceId,
        } as AwsTrustSetupOptions);

        res.json({ data });
      } catch (e: unknown) {
        res.status(400).json({
          error: {
            message: e instanceof Error ? e.message : 'Failed to resolve setup',
          },
        });
      }
    },
  );

  router.get(
    '/:id/aws/organizations/accounts-preview',
    requireScopes(SCOPES.integration.query),
    async (req, res) => {
      const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      const integration = await integrationDao.getByIdOrSlug(
        req.params.id,
        workspaceId,
      );

      const configurationError = await getIntegrationConfigurationError(
        integration,
        {
          secretStore,
        },
      );
      if (configurationError) {
        res.status(400).json({
          error: {
            message: configurationError,
          },
        });
        return;
      }

      const scopeId = getOptionalScopeId?.(req);
      const readinessError = await getIntegrationReadinessError(integration, {
        githubAppDao,
        githubAppInstallationDao,
      });
      if (readinessError) {
        res.status(400).json({
          error: { message: readinessError },
        });
        return;
      }

      if (integration.backendType !== 'aws') {
        res.status(400).json({
          error: {
            message: `Backend type mismatch: AWS organizations preview only supports aws integrations but integration is ${integration.backendType}`,
          },
        });
        return;
      }

      const data = await integrationClient.request(integration.id, {
        backendType: 'aws',
        requestKind: 'organizations-account-preview',
        scopeId,
        workspaceId,
      } as AwsOrganizationsAccountPreviewOptions);

      res.json({ data });
    },
  );

  router.post(
    '/',
    requireScopes(SCOPES.integration.create),
    async (req, res) => {
      const userId = await getUserId(req);

      const result = createIntegrationSchema.safeParse(req.body);
      if (!result.success) {
        const firstError = result.error.issues[0];
        res.status(400).json({
          error: { message: firstError.message },
        });
        return;
      }

      const body = result.data;

      const integration = await integrationDao.create(
        {
          name: body.name,
          slug: body.slug,
          type: body.type,
          host: body.host ?? '',
          authType: body.authType,
          authConfig:
            body.authType === 'none' ? null : (body.authConfig ?? null),
          backendType: body.backendType,
          requestsPerHour: body.requestsPerHour,
          requestsPerSecond: body.requestsPerSecond,
          burstCapacity: body.burstCapacity,
          config: body.config,
          logoSvg: body.logoSlug ? getLogoSvg(body.logoSlug) : undefined,
          graphqlPath: body.graphqlPath ?? null,
          createdBy: userId ?? 'anonymous',
        },
        getWorkspaceId(req),
      );

      logger.info(`Created integration: ${integration.name}`);
      res.status(201).json({ data: integration });
    },
  );

  const replaceIntegration: express.RequestHandler = async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const existingIntegration = await integrationDao.getById(
      req.params.id,
      workspaceId,
    );

    const result = updateIntegrationSchema.safeParse(req.body);
    if (!result.success) {
      const firstError = result.error.issues[0];
      res.status(400).json({
        error: { message: firstError.message },
      });
      return;
    }

    const body = result.data;

    if (body.name === undefined || body.slug === undefined) {
      res.status(400).json({
        error: {
          message:
            'name and slug are required (PUT replaces the whole integration; use PATCH to change one field)',
        },
      });
      return;
    }

    // authConfig keeps merge behavior: it holds ${SECRET_REF} placeholders and
    // this API is not where credentials are managed.
    const authType = body.authType ?? existingIntegration.authType;
    const authConfig =
      body.authConfig !== undefined
        ? body.authConfig
        : existingIntegration.authConfig;

    if (isEditableAuthType(authType) && authType !== 'none' && !authConfig) {
      res.status(400).json({
        error: {
          message: 'authConfig is required for the selected authType',
        },
      });
      return;
    }

    const input: Record<string, unknown> = {
      name: body.name,
      slug: body.slug,
      config: body.config ?? null,
      requestsPerHour: body.requestsPerHour ?? null,
      requestsPerSecond: body.requestsPerSecond ?? null,
      burstCapacity: body.burstCapacity ?? null,
      graphqlPath: body.graphqlPath ?? null,
      logoSvg: body.logoSlug ? getLogoSvg(body.logoSlug) : null,
    };
    if (body.type !== undefined) {
      input.type = body.type;
    }
    if (body.host !== undefined) {
      input.host = body.host;
    }
    if (body.authType !== undefined) {
      input.authType = body.authType;
    }
    if (body.authConfig !== undefined) {
      input.authConfig = body.authConfig;
    }
    if (body.backendType !== undefined) {
      input.backendType = body.backendType;
    }

    const integration = await integrationDao.update(
      req.params.id,
      input,
      workspaceId,
    );

    await integrationClient.unregisterIntegration(integration.id);

    logger.info(`Updated integration: ${integration.name}`);
    res.json({ data: integration });
  };

  const updateIntegration: express.RequestHandler = async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    const existingIntegration = await integrationDao.getById(
      req.params.id,
      workspaceId,
    );

    const result = updateIntegrationSchema.safeParse(req.body);
    if (!result.success) {
      const firstError = result.error.issues[0];
      res.status(400).json({
        error: { message: firstError.message },
      });
      return;
    }

    const body = result.data;

    const authType = body.authType ?? existingIntegration.authType;
    const authConfig =
      body.authConfig !== undefined
        ? body.authConfig
        : existingIntegration.authConfig;

    if (isEditableAuthType(authType) && authType !== 'none' && !authConfig) {
      res.status(400).json({
        error: {
          message: 'authConfig is required for the selected authType',
        },
      });
      return;
    }

    const input: Record<string, unknown> = {};
    if (body.name !== undefined) {
      input.name = body.name;
    }
    if (body.slug !== undefined) {
      input.slug = body.slug;
    }
    if (body.type !== undefined) {
      input.type = body.type;
    }
    if (body.host !== undefined) {
      input.host = body.host;
    }
    if (body.authType !== undefined) {
      input.authType = body.authType;
    }
    if (body.authConfig !== undefined) {
      input.authConfig = body.authConfig;
    }
    if (body.backendType !== undefined) {
      input.backendType = body.backendType;
    }
    if (body.config !== undefined) {
      input.config = body.config;
    }
    if (body.requestsPerHour !== undefined) {
      input.requestsPerHour = body.requestsPerHour;
    }
    if (body.requestsPerSecond !== undefined) {
      input.requestsPerSecond = body.requestsPerSecond;
    }
    if (body.burstCapacity !== undefined) {
      input.burstCapacity = body.burstCapacity;
    }
    if (body.logoSlug !== undefined) {
      input.logoSvg = body.logoSlug ? getLogoSvg(body.logoSlug) : null;
    }
    if (body.graphqlPath !== undefined) {
      input.graphqlPath = body.graphqlPath;
    }

    const integration = await integrationDao.update(
      req.params.id,
      input,
      workspaceId,
    );

    await integrationClient.unregisterIntegration(integration.id);

    logger.info(`Updated integration: ${integration.name}`);
    res.json({ data: integration });
  };

  router.put(
    '/:id',
    requireScopes(SCOPES.integration.create),
    replaceIntegration,
  );
  router.patch(
    '/:id',
    requireScopes(SCOPES.integration.create),
    updateIntegration,
  );

  router.delete(
    '/:id',
    requireScopes(SCOPES.integration.delete),
    async (req, res) => {
      if (integrationUsage) {
        const { references, unavailable } = await integrationUsage.findUsage(
          req.params.id,
        );

        // Fail closed. A false block costs a retry; a false allow costs
        // uncorrectable, silently-deferred breakage. 503 (not 409) keeps
        // "couldn't check" distinguishable from "in use", and is retryable.
        if (unavailable.length > 0) {
          res.status(503).json({
            error: {
              name: 'ServiceUnavailableError',
              message:
                'Could not verify whether this integration is still in use; ' +
                'nothing was deleted. Try again shortly.',
            },
            unavailableProbes: unavailable,
          });
          return;
        }

        if (references.length > 0) {
          // The message must stand alone: the frontend's ResponseError keeps
          // only this string, not the structured payload beside it.
          res.status(409).json({
            error: {
              name: 'ConflictError',
              message: `This integration is used by ${
                references.length
              } resource${
                references.length === 1 ? '' : 's'
              } and cannot be deleted: ${describeUsage(references)}.`,
            },
            usage: { total: references.length, references },
          });
          return;
        }
      }

      await integrationDao.delete(req.params.id, getWorkspaceId(req));
      await integrationClient.unregisterIntegration(req.params.id);
      logger.info(`Deleted integration: ${req.params.id}`);
      res.json({ success: true });
    },
  );

  return router;
}
