import { Router, Request, RequestHandler, json } from 'express';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import { IndexDao, DatastoreRepository } from '../../database';
import { validate as isUuid } from 'uuid';
import { v4 as uuid } from 'uuid';
import jsonataSafe from '@roadiehq/jsonata-safe';
import { parsePositiveInt, serializeCaughtError } from '../utils';

const MAX_VALUES_LIMIT = 100;
const INDEX_PURPOSES = ['column', 'title', 'subtitle', 'image'] as const;

const jsonata = (expression: string) => {
  return jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase', 'join'],
  });
};

export class IndexConfigurationController {
  private indexDao: IndexDao;
  private datastoreRepository: DatastoreRepository;
  private scopeService: ScopeService;
  private getWorkspaceId: (req: Request) => string | undefined;

  constructor(opts: {
    indexDao: IndexDao;
    datastoreRepository: DatastoreRepository;
    scopeService: ScopeService;
    getWorkspaceId?: (req: Request) => string | undefined;
  }) {
    this.indexDao = opts.indexDao;
    this.datastoreRepository = opts.datastoreRepository;
    this.scopeService = opts.scopeService;
    this.getWorkspaceId = opts.getWorkspaceId ?? (() => undefined);
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;
    router
      .route('/:datasourceId')
      .get(requireScopes(SCOPES.catalogDatastore.query), this.listByDatasource)
      .post(
        requireScopes(SCOPES.catalogDatastore.create),
        json(),
        this.createIndexConfiguration,
      )
      .delete(
        requireScopes(SCOPES.catalogDatastore.delete),
        this.deleteAllIndexConfigurations,
      );

    router
      .route('/:datasourceId/:key')
      .get(
        requireScopes(SCOPES.catalogDatastore.get),
        this.getIndexConfiguration,
      )
      .delete(
        requireScopes(SCOPES.catalogDatastore.delete),
        this.deleteIndexConfiguration,
      );

    router.get(
      '/:datasourceId/:key/values',
      requireScopes(SCOPES.catalogDatastore.query),
      this.listValues,
    );
    router.post(
      '/:datasourceId/:key/rebuild',
      requireScopes(SCOPES.catalogDatastore.execute),
      this.rebuildIndexes,
    );

    return router;
  }

  listByDatasource: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      const items = await this.indexDao.listIndexConfigurations(
        datasourceId,
        this.getWorkspaceId(req),
      );
      return res.send({ items });
    } catch (e: unknown) {
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };

  createIndexConfiguration: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    const { key, valueExpression, purpose } = req.body;

    if (!key || !valueExpression) {
      return res.status(400).json({
        error: 'Invalid request: key and valueExpression are required',
      });
    }

    if (purpose !== undefined && !INDEX_PURPOSES.includes(purpose)) {
      return res.status(400).json({
        error:
          'Invalid request: purpose must be column, title, subtitle, or image',
      });
    }

    try {
      jsonata(valueExpression);
    } catch (e: unknown) {
      return res.status(400).json({
        error: `Invalid value expression provided, it supports JSONata syntax: ${serializeCaughtError(e)}`,
      });
    }

    try {
      const existing = await this.indexDao.getIndexConfiguration(
        datasourceId,
        key,
        this.getWorkspaceId(req),
      );
      if (existing) {
        return res.status(409).json({
          error: `Index configuration for key '${key}' already exists`,
        });
      }

      await this.datastoreRepository.createIndexConfiguration(
        {
          id: uuid(),
          datasourceId,
          key,
          valueExpression,
          purpose: purpose ?? 'column',
        },
        this.getWorkspaceId(req),
      );

      return res.status(201).send({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };

  deleteAllIndexConfigurations: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      await this.indexDao.deleteAllIndexConfigurations(
        datasourceId,
        this.getWorkspaceId(req),
      );
      return res.status(204).send();
    } catch (e: unknown) {
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };

  getIndexConfiguration: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    const key = req.params.key;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      const result = await this.indexDao.getIndexConfiguration(
        datasourceId,
        key,
        this.getWorkspaceId(req),
      );

      if (!result) {
        return res.status(404).json({ error: 'Index configuration not found' });
      }

      return res.send(result);
    } catch (e: unknown) {
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };

  deleteIndexConfiguration: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    const key = req.params.key;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      await this.indexDao.deleteIndexConfiguration(
        datasourceId,
        key,
        this.getWorkspaceId(req),
      );
      return res.status(204).send();
    } catch (e: unknown) {
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };

  /**
   * Typeahead-friendly listing of distinct values currently held by an index.
   * `q` is matched as a case-insensitive substring against each value; results
   * are alphabetically ordered and capped (default 20, hard max 100).
   */
  listValues: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    const key = req.params.key;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const parsedLimit = parsePositiveInt(req.query.limit);
    const limit = parsedLimit
      ? Math.min(parsedLimit, MAX_VALUES_LIMIT)
      : undefined;

    try {
      const items = await this.indexDao.listValues(datasourceId, key, {
        workspaceId: this.getWorkspaceId(req),
        q,
        limit,
      });
      return res.send({ items });
    } catch (e: unknown) {
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };

  rebuildIndexes: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    const key = req.params.key;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      await this.datastoreRepository.rebuildIndexes(
        datasourceId,
        key,
        this.getWorkspaceId(req),
      );
      return res.status(200).send({ success: true });
    } catch (e: unknown) {
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };
}
