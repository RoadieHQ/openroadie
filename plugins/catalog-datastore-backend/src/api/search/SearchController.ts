import { Router, Request, RequestHandler } from 'express';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import { ObjectDao, RelationshipDao, ContextGroupDao } from '../../database';
import { validate as isUuid } from 'uuid';
import { parsePositiveInt } from '../utils';

const MAX_LIMIT = 200;

export class SearchController {
  private objectDao: ObjectDao;
  private relationshipDao: RelationshipDao;
  private contextGroupDao: ContextGroupDao;
  private scopeService: ScopeService;
  private getWorkspaceId: (req: Request) => string | undefined;

  constructor(opts: {
    objectDao: ObjectDao;
    relationshipDao: RelationshipDao;
    contextGroupDao: ContextGroupDao;
    scopeService: ScopeService;
    getWorkspaceId?: (req: Request) => string | undefined;
  }) {
    this.objectDao = opts.objectDao;
    this.relationshipDao = opts.relationshipDao;
    this.contextGroupDao = opts.contextGroupDao;
    this.scopeService = opts.scopeService;
    this.getWorkspaceId = opts.getWorkspaceId ?? (() => undefined);
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;
    router.get('/', requireScopes(SCOPES.catalogDatastore.query), this.search);
    return router;
  }

  search: RequestHandler = async (req, res) => {
    const { q, datasourceIds, limit, offset, explain } = req.query;

    if (!q || typeof q !== 'string' || q.trim() === '') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    let parsedDatasourceIds: string[] | undefined;
    if (datasourceIds) {
      const ids =
        typeof datasourceIds === 'string'
          ? datasourceIds.split(',').map(id => id.trim())
          : [];
      for (const id of ids) {
        if (!isUuid(id)) {
          return res.status(400).json({ error: `Invalid datasourceId: ${id}` });
        }
      }
      parsedDatasourceIds = ids.length > 0 ? ids : undefined;
    }

    const parsedLimit = parsePositiveInt(limit);
    const parsedOffset = parsePositiveInt(offset);

    try {
      const result = await this.objectDao.search({
        workspaceId: this.getWorkspaceId(req),
        q: q.trim(),
        datasourceIds: parsedDatasourceIds,
        limit: parsedLimit ? Math.min(parsedLimit, MAX_LIMIT) : undefined,
        offset: parsedOffset,
        explain: explain === 'true',
      });

      if (result.items.length === 0) {
        return res.send(result);
      }

      const objects = result.items.map(
        (item: { datasourceId: string; objectId: string }) => ({
          datasourceId: item.datasourceId,
          objectId: item.objectId,
        }),
      );

      const [relationshipsMap, contextGroupsMap] = await Promise.all([
        this.relationshipDao.getRelationshipsForObjects(
          objects,
          this.getWorkspaceId(req),
        ),
        this.contextGroupDao.findGroupsForObjects(
          objects,
          this.getWorkspaceId(req),
        ),
      ]);

      const enrichedItems = result.items.map(
        (item: { datasourceId: string; objectId: string }) => {
          const key = `${item.datasourceId}:${item.objectId}`;
          return {
            ...item,
            relationships: relationshipsMap.get(key) ?? [],
            contextGroups: contextGroupsMap.get(key) ?? [],
          };
        },
      );

      return res.send({
        ...result,
        items: enrichedItems,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
  };
}
