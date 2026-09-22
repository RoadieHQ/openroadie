import Router from 'express-promise-router';
import express from 'express';
import {
  LoggerService,
  HttpAuthService,
  callerAttribution,
} from '@roadiehq/extensions-api';
import { z } from 'zod';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { SCOPES } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import { InputError, NotFoundError, NotAllowedError } from '@roadiehq/errors';
import { GithubAppService } from '../../service/GithubAppService';
import { GithubAppDao, IntegrationDao } from '../../database';
import type { GithubApp } from '../../database/GithubAppDao';

export interface GithubAppRouterOptions {
  logger: LoggerService;
  githubAppService: GithubAppService;
  /**
   * DAOs are optional so test setups that only exercise the install/token
   * flows can construct the router without wiring full integration storage.
   * When omitted, the `/apps` CRUD routes are not mounted.
   */
  githubAppDao?: GithubAppDao;
  integrationDao?: IntegrationDao;
  httpAuth: HttpAuthService;
  scopeService: ScopeService;
  getWorkspaceId?: (req: express.Request) => string | undefined;
}

const appUpsertSchema = z.object({
  appId: z.string().min(1, { message: 'appId is required' }),
  slug: z.string().optional().nullable(),
  htmlUrl: z
    .string()
    .url()
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  description: z.string().optional().nullable(),
  purposes: z.array(z.string().min(1)).optional(),
  privateKeyRef: z.string().optional().nullable(),
  webhookSecretRef: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  clientSecretRef: z.string().optional().nullable(),
  kmsKeyId: z.string().optional().nullable(),
});

const appCreateSchema = appUpsertSchema.extend({
  integrationId: z.string().min(1, { message: 'integrationId is required' }),
  enterpriseServerHost: z.string().optional().nullable(),
});

const appUpdateSchema = appUpsertSchema.partial();

const installLinkQuerySchema = z.object({
  appId: z.string().min(1),
  host: z.string().optional(),
  redirectUrl: z.string().url(),
});

const tokenRequestSchema = z.object({
  url: z.string().url(),
  purpose: z.string().min(1),
});

const testRequestSchema = z.object({
  appId: z.string().min(1),
  host: z.string().optional(),
});

function errorStatus(error: unknown): number {
  if (error instanceof InputError) {
    return 400;
  }
  if (error instanceof NotAllowedError) {
    return 403;
  }
  if (error instanceof NotFoundError) {
    return 404;
  }
  return 500;
}

function normalizeRef(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function deriveHostFromIntegration(integrationHost: string): string {
  const raw = (integrationHost ?? '').trim();
  if (!raw) {
    return 'github.com';
  }
  let hostName: string;
  if (raw.includes('://')) {
    try {
      hostName = new URL(raw).host;
    } catch {
      return 'github.com';
    }
  } else {
    hostName = raw.split('/')[0] ?? 'github.com';
  }
  return hostName.toLowerCase() === 'api.github.com' ? 'github.com' : hostName;
}

function parseGithubEnterpriseHostnameInput(
  input: string | undefined | null,
): string | undefined {
  const raw = normalizeRef(input);
  if (!raw) {
    return undefined;
  }
  if (raw.includes('://')) {
    try {
      return new URL(raw).host;
    } catch {
      throw new InputError('Invalid enterprise server URL');
    }
  }
  const segment = raw.split('/')[0]?.trim();
  return segment || undefined;
}

async function getCallerIdentity(
  req: express.Request,
  httpAuth: HttpAuthService,
): Promise<string> {
  return callerAttribution(httpAuth, req);
}

function resolveHostForGithubAppCreate(
  integration: { slug: string; host: string },
  enterpriseServerHost?: string | null,
): string {
  const intHost = (integration.host ?? '').trim();
  if (integration.slug === 'github-enterprise-app' && !intHost) {
    const fromBody = parseGithubEnterpriseHostnameInput(enterpriseServerHost);
    if (!fromBody) {
      throw new InputError(
        'Provide enterpriseServerHost (your GitHub Enterprise hostname or URL) until the integration API URL is configured.',
      );
    }
    return fromBody;
  }
  return deriveHostFromIntegration(integration.host);
}

async function assertGithubAppInWorkspace(
  app: GithubApp,
  integrationDao: IntegrationDao,
  workspaceId: string | undefined,
): Promise<void> {
  if (!app.integrationId) {
    if ((workspaceId ?? DEFAULT_WORKSPACE_ID) !== DEFAULT_WORKSPACE_ID) {
      throw new NotFoundError(`GitHub App not found: ${app.id}`);
    }
    return;
  }
  await integrationDao.getById(app.integrationId, workspaceId);
}

export function createGithubAppRouter(
  options: GithubAppRouterOptions,
): express.Router {
  const {
    githubAppService,
    githubAppDao,
    integrationDao,
    httpAuth,
    scopeService,
    getWorkspaceId = () => undefined,
  } = options;

  const router = Router();
  const requireScopes = scopeService.requireScopes;

  router.get(
    '/install-link',
    requireScopes(SCOPES.integration.get),
    async (req, res) => {
      const parsed = installLinkQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            message: `Invalid query: ${parsed.error.issues
              .map(i => i.message)
              .join('; ')}`,
          },
        });
        return;
      }

      try {
        const callbackOrigin = `${req.protocol}://${req.get('host')}`;
        const { installUrl } = await githubAppService.generateInstallLink({
          appId: parsed.data.appId,
          host: parsed.data.host,
          redirectUrl: parsed.data.redirectUrl,
          callbackOrigin,
          workspaceId: getWorkspaceId(req),
        });
        res.json({ data: { installUrl } });
      } catch (error: unknown) {
        const status = errorStatus(error);
        res.status(status).json({
          error: {
            message: error instanceof Error ? error.message : 'Internal error',
          },
        });
      }
    },
  );

  router.get('/callback', async (req, res) => {
    const installationIdParam = req.query.installation_id;
    const stateParam = req.query.state;
    const setupAction = req.query.setup_action;
    const codeParam = req.query.code;

    if (!stateParam || typeof stateParam !== 'string') {
      res.status(400).json({ error: { message: 'Missing state parameter' } });
      return;
    }

    try {
      const { redirectUrl } = await githubAppService.handleCallback({
        stateParam,
        installationIdParam:
          typeof installationIdParam === 'string'
            ? installationIdParam
            : undefined,
        setupAction: typeof setupAction === 'string' ? setupAction : undefined,
        codeParam: typeof codeParam === 'string' ? codeParam : undefined,
      });
      res.redirect(redirectUrl);
    } catch (error: unknown) {
      const status = errorStatus(error);
      res.status(status).json({
        error: {
          message: error instanceof Error ? error.message : 'Internal error',
        },
      });
    }
  });

  router.get(
    '/installations',
    requireScopes(SCOPES.integration.query),
    async (req, res) => {
      const appId =
        typeof req.query.appId === 'string' ? req.query.appId : undefined;
      const host =
        typeof req.query.host === 'string' ? req.query.host : undefined;
      const installations = await githubAppService.listInstallations(
        appId,
        host,
        getWorkspaceId(req),
      );
      res.json({ data: installations });
    },
  );

  router.get(
    '/install-requests',
    requireScopes(SCOPES.integration.query),
    async (req, res) => {
      const appId =
        typeof req.query.appId === 'string' ? req.query.appId : undefined;
      const requests = await githubAppService.listInstallRequests(
        appId,
        getWorkspaceId(req),
      );
      res.json({ data: requests });
    },
  );

  router.delete(
    '/installations/:id',
    requireScopes(SCOPES.integration.delete),
    async (req, res) => {
      try {
        await githubAppService.deleteInstallation(
          req.params.id,
          getWorkspaceId(req),
        );
      } catch (error: unknown) {
        const status = errorStatus(error);
        res.status(status).json({
          error: {
            message: error instanceof Error ? error.message : 'Internal error',
          },
        });
        return;
      }

      res.json({ success: true });
    },
  );

  router.get(
    '/apps',
    requireScopes(SCOPES.integration.query),
    async (req, res) => {
      if (!githubAppDao || !integrationDao) {
        res
          .status(503)
          .json({ error: { message: 'GitHub App store is not available' } });
        return;
      }
      const integrationId =
        typeof req.query.integrationId === 'string'
          ? req.query.integrationId
          : undefined;

      let apps;
      if (integrationId) {
        await integrationDao.getById(integrationId, getWorkspaceId(req));
        apps = await githubAppDao.listAppsByIntegrationId(integrationId);
      } else {
        const workspaceId = getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
        apps = await githubAppDao.listAppsByWorkspaceId(workspaceId);
      }

      res.json({ data: apps });
    },
  );

  router.post(
    '/apps',
    requireScopes(SCOPES.integration.create),
    async (req, res) => {
      if (!githubAppDao || !integrationDao) {
        res
          .status(503)
          .json({ error: { message: 'GitHub App store is not available' } });
        return;
      }
      const parsed = appCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            message: `Invalid request body: ${parsed.error.issues
              .map(i => i.message)
              .join('; ')}`,
          },
        });
        return;
      }

      let integration;
      try {
        integration = await integrationDao.getById(
          parsed.data.integrationId,
          getWorkspaceId(req),
        );
      } catch (error: unknown) {
        const status = errorStatus(error);
        res.status(status).json({
          error: {
            message:
              error instanceof Error ? error.message : 'Integration not found',
          },
        });
        return;
      }

      if (integration.authType !== 'github-app') {
        res.status(400).json({
          error: {
            message:
              'GitHub Apps can only be linked to GitHub App integrations',
          },
        });
        return;
      }

      let host: string;
      try {
        host = resolveHostForGithubAppCreate(
          integration,
          parsed.data.enterpriseServerHost,
        );
      } catch (error: unknown) {
        const status = errorStatus(error);
        res.status(status).json({
          error: {
            message: error instanceof Error ? error.message : 'Invalid host',
          },
        });
        return;
      }

      try {
        const app = await githubAppDao.upsertApp({
          workspaceId: getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID,
          appId: parsed.data.appId,
          host,
          slug: normalizeRef(parsed.data.slug),
          htmlUrl: normalizeRef(parsed.data.htmlUrl),
          description: normalizeRef(parsed.data.description),
          purposes: parsed.data.purposes,
          privateKeyRef: normalizeRef(parsed.data.privateKeyRef),
          webhookSecretRef: normalizeRef(parsed.data.webhookSecretRef),
          clientId: normalizeRef(parsed.data.clientId),
          clientSecretRef: normalizeRef(parsed.data.clientSecretRef),
          kmsKeyId: normalizeRef(parsed.data.kmsKeyId),
          integrationId: integration.id,
        });
        res.status(201).json({ data: app });
      } catch (error: unknown) {
        const status = errorStatus(error);
        res.status(status).json({
          error: {
            message: error instanceof Error ? error.message : 'Internal error',
          },
        });
      }
    },
  );

  router.patch(
    '/apps/:id',
    requireScopes(SCOPES.integration.create),
    async (req, res) => {
      if (!githubAppDao || !integrationDao) {
        res
          .status(503)
          .json({ error: { message: 'GitHub App store is not available' } });
        return;
      }
      const parsed = appUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            message: `Invalid request body: ${parsed.error.issues
              .map(i => i.message)
              .join('; ')}`,
          },
        });
        return;
      }

      try {
        const existing = await githubAppDao.getById(req.params.id);
        await assertGithubAppInWorkspace(
          existing,
          integrationDao,
          getWorkspaceId(req),
        );
        const updates: Parameters<typeof githubAppDao.updateApp>[1] = {};
        if (parsed.data.appId !== undefined) {
          updates.appId = parsed.data.appId;
        }
        if (parsed.data.purposes !== undefined) {
          updates.purposes = parsed.data.purposes;
        }
        for (const key of [
          'slug',
          'htmlUrl',
          'description',
          'privateKeyRef',
          'webhookSecretRef',
          'clientId',
          'clientSecretRef',
          'kmsKeyId',
        ] as const) {
          if (parsed.data[key] !== undefined) {
            updates[key] = normalizeRef(parsed.data[key]);
          }
        }

        const app = await githubAppDao.updateApp(req.params.id, updates);
        res.json({ data: app });
      } catch (error: unknown) {
        const status = errorStatus(error);
        res.status(status).json({
          error: {
            message: error instanceof Error ? error.message : 'Internal error',
          },
        });
      }
    },
  );

  router.delete(
    '/apps/:id',
    requireScopes(SCOPES.integration.delete),
    async (req, res) => {
      if (!githubAppDao || !integrationDao) {
        res
          .status(503)
          .json({ error: { message: 'GitHub App store is not available' } });
        return;
      }
      try {
        const existing = await githubAppDao.getById(req.params.id);
        await assertGithubAppInWorkspace(
          existing,
          integrationDao,
          getWorkspaceId(req),
        );
        await githubAppDao.deleteApp(req.params.id);
        res.json({ success: true });
      } catch (error: unknown) {
        const status = errorStatus(error);
        res.status(status).json({
          error: {
            message: error instanceof Error ? error.message : 'Internal error',
          },
        });
      }
    },
  );

  router.post(
    '/token',
    requireScopes(SCOPES.integration.create),
    async (req, res) => {
      const parsed = tokenRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            message: `Invalid request body: ${parsed.error.issues
              .map(i => i.message)
              .join('; ')}`,
          },
        });
        return;
      }

      const callerIdentity = await getCallerIdentity(req, httpAuth);

      try {
        const { token } = await githubAppService.createToken({
          url: parsed.data.url,
          purpose: parsed.data.purpose,
          callerIdentity,
          workspaceId: getWorkspaceId(req),
        });
        res.json({ data: { token } });
      } catch (error: unknown) {
        const status = errorStatus(error);
        if (status >= 500) {
          res.status(502).json({
            error: {
              message: 'Failed to mint GitHub App installation token',
            },
          });
        } else {
          res.status(status).json({
            error: {
              message:
                error instanceof Error ? error.message : 'Internal error',
            },
          });
        }
      }
    },
  );

  router.post(
    '/test',
    requireScopes(SCOPES.integration.query),
    async (req, res) => {
      const parsed = testRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            message: `Invalid request body: ${parsed.error.issues
              .map(i => i.message)
              .join('; ')}`,
          },
        });
        return;
      }

      const callerIdentity = await getCallerIdentity(req, httpAuth);

      try {
        const result = await githubAppService.testAppConnection({
          appId: parsed.data.appId,
          host: parsed.data.host,
          callerIdentity,
          workspaceId: getWorkspaceId(req),
        });
        res.json({ data: result });
      } catch (error: unknown) {
        const status = errorStatus(error);
        res.status(status).json({
          error: {
            message: error instanceof Error ? error.message : 'Internal error',
          },
        });
      }
    },
  );

  return router;
}
