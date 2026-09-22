import Router from 'express-promise-router';
import express from 'express';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import { NotFoundError } from '@roadiehq/errors';
import { GraphLayoutDao } from '@roadiehq/catalog-workflow-data';

export interface GraphLayoutsRouterOptions {
  graphLayoutDao: Pick<
    GraphLayoutDao,
    'list' | 'getByName' | 'upsert' | 'delete'
  >;
  getUserId: (req: express.Request) => Promise<string | undefined>;
  getWorkspaceId: (req: express.Request) => string | undefined;
  scopeService: ScopeService;
}

export function createGraphLayoutsRouter(
  options: GraphLayoutsRouterOptions,
): express.Router {
  const { graphLayoutDao, getUserId, getWorkspaceId, scopeService } = options;

  const router = Router();
  const requireScopes = scopeService.requireScopes;

  router.get(
    '/',
    requireScopes(SCOPES.catalogWorkflow.query),
    async (req, res) => {
      const layouts = await graphLayoutDao.list(getWorkspaceId(req));
      res.json({ data: layouts });
    },
  );

  router.get(
    '/:name',
    requireScopes(SCOPES.catalogWorkflow.get),
    async (req, res) => {
      const layout = await graphLayoutDao.getByName(
        req.params.name,
        getWorkspaceId(req),
      );
      if (!layout) {
        throw new NotFoundError(`Graph layout not found: ${req.params.name}`);
      }
      res.json({ data: layout });
    },
  );

  router.put(
    '/:name',
    requireScopes(SCOPES.catalogWorkflow.create),
    async (req, res) => {
      const userId = await getUserId(req);
      const { nodes, edges, viewport } = req.body;
      const layout = await graphLayoutDao.upsert(
        req.params.name,
        {
          nodes,
          edges,
          viewport,
          updatedBy: userId,
        },
        getWorkspaceId(req),
      );
      res.json({ data: layout });
    },
  );

  router.delete(
    '/:name',
    requireScopes(SCOPES.catalogWorkflow.delete),
    async (req, res) => {
      const deleted = await graphLayoutDao.delete(
        req.params.name,
        getWorkspaceId(req),
      );
      if (!deleted) {
        throw new NotFoundError(`Graph layout not found: ${req.params.name}`);
      }
      res.status(204).send();
    },
  );

  return router;
}
