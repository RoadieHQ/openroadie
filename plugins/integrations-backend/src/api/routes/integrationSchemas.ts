import Router from 'express-promise-router';
import express from 'express';
import { LoggerService } from '@roadiehq/extensions-api';
import { JsonValue } from '@roadiehq/types';
import { IntegrationSchemaDao } from '../../database';
import { z } from 'zod';
import { SCOPES } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import { SchemaProcessor } from '../../processors/SchemaProcessor';
import type {
  CreateIntegrationSchemaInput,
  UpdateIntegrationSchemaInput,
} from '../../database/schemaTypes';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

export interface IntegrationSchemasRouterOptions {
  logger: LoggerService;
  integrationSchemaDao: IntegrationSchemaDao;
  schemaProcessor?: SchemaProcessor;
  scopeService: ScopeService;
  getWorkspaceId: (req: express.Request) => string | undefined;
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

const createSchemaBody = z.object({
  integrationId: z.string().min(1, { message: 'integrationId is required' }),
  pathPattern: z.string().min(1, { message: 'pathPattern is required' }),
  method: z.string().toUpperCase().default('GET'),
  jsonSchema: z.record(z.string(), z.unknown()),
  sourceType: z.enum(['spec', 'inferred'] as const).default('spec'),
  isOverride: z.boolean().default(false),
  specUrl: z.string().optional(),
  description: z.string().optional(),
  paginationHint: z.record(z.string(), z.unknown()).optional(),
  paginationDefault: z.record(z.string(), z.unknown()).optional(),
});

const updateSchemaBody = z.object({
  pathPattern: z.string().min(1).optional(),
  method: z.string().toUpperCase().optional(),
  jsonSchema: z.record(z.string(), z.unknown()).optional(),
  sourceType: z.enum(['spec', 'inferred'] as const).optional(),
  isOverride: z.boolean().optional(),
  description: z.string().optional(),
  paginationHint: z.record(z.string(), z.unknown()).optional(),
  paginationDefault: z.record(z.string(), z.unknown()).optional(),
});

const createSpecUrlBody = z.object({
  integrationId: z.string().min(1, { message: 'integrationId is required' }),
  specUrl: z.string().min(1, { message: 'specUrl is required' }),
  specFormat: z.enum(['openapi', 'asyncapi'] as const).default('openapi'),
});

const updateSpecUrlBody = z.object({
  specUrl: z.string().min(1).optional(),
  specFormat: z.enum(['openapi', 'asyncapi'] as const).optional(),
});

export function createIntegrationSchemasRouter(
  options: IntegrationSchemasRouterOptions,
): express.Router {
  const {
    logger,
    integrationSchemaDao,
    schemaProcessor,
    scopeService,
    getWorkspaceId,
  } = options;

  const router = Router();
  const requireScopes = scopeService.requireScopes;
  const resolveWorkspaceId = (req: express.Request) =>
    getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;

  router.get('/', requireScopes(SCOPES.integration.query), async (req, res) => {
    const integrationId =
      typeof req.query.integrationId === 'string'
        ? req.query.integrationId
        : undefined;
    const path =
      typeof req.query.path === 'string' ? req.query.path : undefined;
    const method =
      typeof req.query.method === 'string' ? req.query.method : undefined;
    const sourceType =
      typeof req.query.sourceType === 'string'
        ? req.query.sourceType
        : undefined;
    const pathSearch =
      typeof req.query.pathSearch === 'string'
        ? req.query.pathSearch
        : undefined;

    if (integrationId && path) {
      const schema = await integrationSchemaDao.getSchemaWithOverrides(
        integrationId,
        path,
        method,
        resolveWorkspaceId(req),
      );
      if (!schema) {
        res.status(404).json({
          error: {
            message: `No schema found for ${integrationId} ${path}`,
          },
        });
        return;
      }
      res.json({ data: schema });
      return;
    }

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

    const result = await integrationSchemaDao.listSchemas({
      workspaceId: resolveWorkspaceId(req),
      integrationId,
      pathPattern: path,
      pathSearch,
      method,
      sourceType,
      limit: limitResult.value,
      offset: offsetResult.value,
    });

    res.json({
      data: result.schemas,
      total: result.total,
      offset: offsetResult.value ?? 0,
      limit: limitResult.value ?? 50,
    });
  });

  router.get(
    '/paths',
    requireScopes(SCOPES.integration.query),
    async (req, res) => {
      const integrationId =
        typeof req.query.integrationId === 'string'
          ? req.query.integrationId
          : undefined;
      const method =
        typeof req.query.method === 'string' ? req.query.method : undefined;

      if (!integrationId) {
        res.status(400).json({
          error: { message: 'integrationId query parameter is required' },
        });
        return;
      }

      const paths = await integrationSchemaDao.listPathSuggestions(
        integrationId,
        method,
        resolveWorkspaceId(req),
      );
      res.json({ data: paths });
    },
  );

  router.post(
    '/',
    requireScopes(SCOPES.integration.create),
    async (req, res) => {
      const result = createSchemaBody.safeParse(req.body);
      if (!result.success) {
        const firstError = result.error.issues[0];
        res.status(400).json({
          error: { message: firstError.message },
        });
        return;
      }

      const body = result.data;
      const schema = await integrationSchemaDao.createSchema(
        {
          integrationId: body.integrationId,
          pathPattern: body.pathPattern,
          method: body.method,
          jsonSchema: body.jsonSchema as JsonValue,
          sourceType: body.sourceType,
          isOverride: body.isOverride,
          specUrl: body.specUrl,
          description: body.description,
          paginationHint: body.paginationHint as
            | CreateIntegrationSchemaInput['paginationHint']
            | undefined,
          paginationDefault: body.paginationDefault as
            | CreateIntegrationSchemaInput['paginationDefault']
            | undefined,
        },
        resolveWorkspaceId(req),
      );

      logger.info(
        `Created integration schema: ${schema.integrationId} ${schema.pathPattern}`,
      );
      res.status(201).json({ data: schema });
    },
  );

  router.put(
    '/:id',
    requireScopes(SCOPES.integration.create),
    async (req, res) => {
      const result = updateSchemaBody.safeParse(req.body);
      if (!result.success) {
        const firstError = result.error.issues[0];
        res.status(400).json({
          error: { message: firstError.message },
        });
        return;
      }

      const schema = await integrationSchemaDao.updateSchema(
        req.params.id,
        {
          ...result.data,
          jsonSchema: result.data.jsonSchema as JsonValue | undefined,
          paginationHint: result.data.paginationHint as
            | UpdateIntegrationSchemaInput['paginationHint']
            | undefined,
          paginationDefault: result.data.paginationDefault as
            | UpdateIntegrationSchemaInput['paginationDefault']
            | undefined,
        },
        resolveWorkspaceId(req),
      );

      logger.info(
        `Updated integration schema: ${schema.integrationId} ${schema.pathPattern}`,
      );
      res.json({ data: schema });
    },
  );

  router.delete(
    '/:id',
    requireScopes(SCOPES.integration.delete),
    async (req, res) => {
      await integrationSchemaDao.deleteSchema(
        req.params.id,
        resolveWorkspaceId(req),
      );
      logger.info(`Deleted integration schema: ${req.params.id}`);
      res.json({ success: true });
    },
  );

  router.get(
    '/spec-urls',
    requireScopes(SCOPES.integration.query),
    async (req, res) => {
      const integrationId =
        typeof req.query.integrationId === 'string'
          ? req.query.integrationId
          : undefined;

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

      const result = await integrationSchemaDao.listSpecUrls({
        workspaceId: resolveWorkspaceId(req),
        integrationId,
        limit: limitResult.value,
        offset: offsetResult.value,
      });

      res.json({
        data: result.specUrls,
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
      const schema = await integrationSchemaDao.getSchemaById(
        req.params.id,
        resolveWorkspaceId(req),
      );
      res.json({ data: schema });
    },
  );

  router.post(
    '/spec-urls',
    requireScopes(SCOPES.integration.create),
    async (req, res) => {
      const result = createSpecUrlBody.safeParse(req.body);
      if (!result.success) {
        const firstError = result.error.issues[0];
        res.status(400).json({ error: { message: firstError.message } });
        return;
      }

      const specUrl = await integrationSchemaDao.createSpecUrl(
        result.data,
        resolveWorkspaceId(req),
      );

      if (schemaProcessor) {
        schemaProcessor.processSpecUrlWithTracking(specUrl).catch(err => {
          logger.warn(
            `Inline spec processing failed for ${specUrl.integrationId} (${specUrl.specUrl}): ${err}`,
          );
        });
      }

      logger.info(
        `Created spec URL for ${specUrl.integrationId}: ${specUrl.specUrl}`,
      );
      res.status(201).json({ data: specUrl });
    },
  );

  router.put(
    '/spec-urls/:id',
    requireScopes(SCOPES.integration.create),
    async (req, res) => {
      const validationResult = updateSpecUrlBody.safeParse(req.body);
      if (!validationResult.success) {
        const firstError = validationResult.error.issues[0];
        res.status(400).json({ error: { message: firstError.message } });
        return;
      }

      const { specUrl, urlChanged } = await integrationSchemaDao.updateSpecUrl(
        req.params.id,
        validationResult.data,
        resolveWorkspaceId(req),
      );

      if (urlChanged && schemaProcessor) {
        schemaProcessor.processSpecUrlWithTracking(specUrl).catch(err => {
          logger.warn(
            `Inline spec processing failed for ${specUrl.integrationId} (${specUrl.specUrl}): ${err}`,
          );
        });
      }

      logger.info(
        `Updated spec URL for ${specUrl.integrationId}: ${specUrl.specUrl}`,
      );
      res.json({ data: specUrl });
    },
  );

  router.delete(
    '/spec-urls/:id',
    requireScopes(SCOPES.integration.delete),
    async (req, res) => {
      await integrationSchemaDao.deleteSpecUrl(
        req.params.id,
        resolveWorkspaceId(req),
      );
      logger.info(`Deleted spec URL: ${req.params.id}`);
      res.json({ success: true });
    },
  );

  return router;
}
