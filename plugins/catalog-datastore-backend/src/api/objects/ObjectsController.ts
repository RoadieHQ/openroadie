import { Router, Request, RequestHandler, json } from 'express';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import {
  ObjectDao,
  SchemaDao,
  RelationshipDao,
  ContextGroupDao,
  DatastoreRepository,
} from '../../database';
import { validate as isUuid } from 'uuid';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import {
  OBJECT_GRAPH_DEFAULT_LIMIT,
  OBJECT_GRAPH_PATHS_DEFAULT_MAX_DEPTH,
  OBJECT_GRAPH_PATHS_LIMIT,
  OBJECT_GRAPH_PATHS_MAX_DEPTH,
  ROOTED_OBJECT_GRAPH_DEFAULT_DEPTH,
  ROOTED_OBJECT_GRAPH_MAX_DEPTH,
  ROOTED_OBJECT_GRAPH_SERVER_NODE_LIMIT,
  SortOrder,
  type GraphEdgeOriginFilter,
  type GraphTraversalDirection,
  type ObjectGraphPathsResult,
  type RootedObjectGraphResult,
} from '@roadiehq/catalog-datastore-common';
import type { GraphEdgeTraversalFilters } from '../../database/RelationshipDao';
import {
  parseClampedIntParam,
  parseCsvStringsParam,
  parseCsvUuidsParam,
} from '../utils';

const GRAPH_DIRECTIONS: readonly GraphTraversalDirection[] = [
  'out',
  'in',
  'both',
];
const GRAPH_ORIGINS: readonly GraphEdgeOriginFilter[] = ['rule', 'direct'];
/**
 * The shared edge-filter params of the graph traversal endpoints
 * (datasourceIds/relationshipTypes/origin/direction). Returns an error
 * string instead of filters when a param is malformed.
 */
function parseGraphTraversalFilters(
  query: Record<string, unknown>,
): { filters: GraphEdgeTraversalFilters } | { error: string } {
  const datasourceIds = parseCsvUuidsParam(query.datasourceIds);
  if (!datasourceIds.ok) {
    return { error: 'Invalid datasourceIds' };
  }
  const direction = (query.direction ?? 'both') as GraphTraversalDirection;
  if (!GRAPH_DIRECTIONS.includes(direction)) {
    return { error: 'Invalid direction' };
  }
  const origin = query.origin as GraphEdgeOriginFilter | undefined;
  if (origin !== undefined && !GRAPH_ORIGINS.includes(origin)) {
    return { error: 'Invalid origin' };
  }
  return {
    filters: {
      direction,
      datasourceIds: datasourceIds.ids,
      relationshipTypes: parseCsvStringsParam(query.relationshipTypes),
      origin,
    },
  };
}

export class ObjectsController {
  private objectDao: ObjectDao;
  private schemaDao: SchemaDao;
  private relationshipDao: RelationshipDao;
  private contextGroupDao: ContextGroupDao;
  private datastoreRepository: DatastoreRepository;
  private scopeService: ScopeService;
  private getWorkspaceId: (req: Request) => string | undefined;

  constructor(opts: {
    objectDao: ObjectDao;
    schemaDao: SchemaDao;
    relationshipDao: RelationshipDao;
    contextGroupDao: ContextGroupDao;
    datastoreRepository: DatastoreRepository;
    scopeService: ScopeService;
    getWorkspaceId?: (req: Request) => string | undefined;
  }) {
    this.objectDao = opts.objectDao;
    this.schemaDao = opts.schemaDao;
    this.relationshipDao = opts.relationshipDao;
    this.contextGroupDao = opts.contextGroupDao;
    this.datastoreRepository = opts.datastoreRepository;
    this.scopeService = opts.scopeService;
    this.getWorkspaceId = opts.getWorkspaceId ?? (() => undefined);
  }

  private async withContextGroups<
    T extends { items: Array<{ datasourceId: string; objectId: string }> },
  >(result: T, workspaceId?: string) {
    if (result.items.length === 0) {
      return result;
    }

    const contextGroups = await this.contextGroupDao.findGroupsForObjects(
      result.items.map(item => ({
        datasourceId: item.datasourceId,
        objectId: item.objectId,
      })),
      workspaceId,
    );

    return {
      ...result,
      items: result.items.map(item => ({
        ...item,
        contextGroups:
          contextGroups.get(`${item.datasourceId}:${item.objectId}`) ?? [],
      })),
    };
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;

    router
      .route('/')
      .get(requireScopes(SCOPES.catalogDatastore.query), this.listAll);

    router.post(
      '/join',
      requireScopes(SCOPES.catalogDatastore.query),
      json(),
      this.queryWithJoin,
    );

    // Must be registered before `/:datasourceId` so "counts" is not
    // interpreted as a datasource id.
    router.get(
      '/counts',
      requireScopes(SCOPES.catalogDatastore.query),
      this.getCounts,
    );

    // Node refs travel in query params (object ids are arbitrary text and
    // may contain '/'); like /counts, these must precede `/:datasourceId`.
    router.get(
      '/graph/rooted',
      requireScopes(SCOPES.catalogDatastore.query),
      this.getRootedGraph,
    );
    router.get(
      '/graph/paths',
      requireScopes(SCOPES.catalogDatastore.query),
      this.getGraphPaths,
    );

    router
      .route('/:datasourceId')
      .get(requireScopes(SCOPES.catalogDatastore.query), this.listByDatasource)
      .post(
        requireScopes(SCOPES.catalogDatastore.create),
        json(),
        this.addObject,
      )
      .put(
        requireScopes(SCOPES.catalogDatastore.create),
        json(),
        this.updateDatasource,
      )
      .delete(
        requireScopes(SCOPES.catalogDatastore.delete),
        this.deleteAllObjects,
      );

    router
      .route('/:datasourceId/:objectId')
      .get(requireScopes(SCOPES.catalogDatastore.get), this.getObject)
      .delete(requireScopes(SCOPES.catalogDatastore.delete), this.deleteObject);

    return router;
  }

  listAll: RequestHandler = async (req, res) => {
    const { graph, limit, offset, sortByIndex, sortOrder, datasourceIds } =
      req.query;

    if (graph === 'true') {
      return this.getGraph(req, res, () => undefined);
    }

    if (datasourceIds !== undefined && typeof datasourceIds !== 'string') {
      return res.status(400).json({ error: 'Invalid datasourceIds' });
    }

    const parsedDatasourceIds =
      typeof datasourceIds === 'string' && datasourceIds.trim().length > 0
        ? datasourceIds
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
        : undefined;

    if (parsedDatasourceIds?.some(id => !isUuid(id))) {
      return res.status(400).json({ error: 'Invalid datasourceIds' });
    }

    try {
      const result = await this.objectDao.queryAll({
        workspaceId: this.getWorkspaceId(req),
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        orderBy: sortByIndex as string | undefined,
        sortOrder: sortOrder as SortOrder | undefined,
        datasourceIds: parsedDatasourceIds,
      });
      return res.send(
        await this.withContextGroups(result, this.getWorkspaceId(req)),
      );
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  /**
   * Objects currently stored per datasource — the datastore's own count, as
   * opposed to the "objects fetched by the last run" execution summary.
   */
  getCounts: RequestHandler = async (req, res) => {
    try {
      const items = await this.objectDao.countByDatasource(
        this.getWorkspaceId(req),
      );
      return res.send({ items });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getGraph: RequestHandler = async (req, res) => {
    const { datasourceIds, unlimited } = req.query;

    if (datasourceIds !== undefined && typeof datasourceIds !== 'string') {
      return res.status(400).json({ error: 'Invalid datasourceIds' });
    }

    const parsedDatasourceIds =
      typeof datasourceIds === 'string' && datasourceIds.trim().length > 0
        ? datasourceIds
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
        : undefined;

    if (parsedDatasourceIds?.some(id => !isUuid(id))) {
      return res.status(400).json({ error: 'Invalid datasourceIds' });
    }

    const limit = unlimited === 'true' ? undefined : OBJECT_GRAPH_DEFAULT_LIMIT;

    try {
      const [nodesResult, relationshipsResult] = await Promise.all([
        this.objectDao.queryGraphNodes({
          workspaceId: this.getWorkspaceId(req),
          datasourceIds: parsedDatasourceIds,
          limit,
        }),
        this.relationshipDao.queryGraphRelationships({
          workspaceId: this.getWorkspaceId(req),
          datasourceIds: parsedDatasourceIds,
          limit,
        }),
      ]);
      const truncated =
        nodesResult.items.length < nodesResult.total ||
        relationshipsResult.items.length < relationshipsResult.total;
      return res.send({
        nodes: nodesResult.items,
        relationships: relationshipsResult.items,
        totals: {
          objects: nodesResult.total,
          relationships: relationshipsResult.total,
        },
        truncated,
      });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getRootedGraph: RequestHandler = async (req, res) => {
    const { rootDatasourceId, rootObjectId } = req.query;
    if (typeof rootDatasourceId !== 'string' || !isUuid(rootDatasourceId)) {
      return res.status(400).json({ error: 'Invalid rootDatasourceId' });
    }
    if (typeof rootObjectId !== 'string' || rootObjectId.length === 0) {
      return res.status(400).json({ error: 'Invalid rootObjectId' });
    }
    const parsed = parseGraphTraversalFilters(req.query);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const depth = parseClampedIntParam(req.query.depth, {
      min: 1,
      max: ROOTED_OBJECT_GRAPH_MAX_DEPTH,
      fallback: ROOTED_OBJECT_GRAPH_DEFAULT_DEPTH,
    });
    if (depth === undefined) {
      return res.status(400).json({ error: 'Invalid depth' });
    }
    const nodeLimit = parseClampedIntParam(req.query.nodeLimit, {
      min: 1,
      max: ROOTED_OBJECT_GRAPH_SERVER_NODE_LIMIT,
      fallback: ROOTED_OBJECT_GRAPH_SERVER_NODE_LIMIT,
    });
    if (nodeLimit === undefined) {
      return res.status(400).json({ error: 'Invalid nodeLimit' });
    }

    try {
      const rootExists = await this.objectDao.checkObjectExists(
        rootDatasourceId,
        rootObjectId,
        this.getWorkspaceId(req),
      );
      if (!rootExists) {
        return res.status(404).json({ error: 'Root object not found' });
      }

      const traversal = await this.relationshipDao.traverseFromRoot({
        workspaceId: this.getWorkspaceId(req),
        root: { datasourceId: rootDatasourceId, objectId: rootObjectId },
        depth,
        nodeLimit,
        filters: parsed.filters,
      });
      const summaries = await this.objectDao.queryGraphNodesByRefs(
        traversal.nodes,
        this.getWorkspaceId(req),
      );
      const summariesByKey = new Map(
        summaries.map(summary => [
          `${summary.datasourceId}:${summary.objectId}`,
          summary,
        ]),
      );
      // Traversal order (depth, then key) is the response order; refs whose
      // object vanished between the walk and the label query just drop out.
      const nodes = traversal.nodes.flatMap(ref => {
        const key = `${ref.datasourceId}:${ref.objectId}`;
        const summary = summariesByKey.get(key);
        if (!summary) {
          return [];
        }
        return [
          {
            ...summary,
            depth: ref.depth,
            hiddenNeighborCount: traversal.hiddenNeighborCounts.get(key) ?? 0,
          },
        ];
      });

      const result: RootedObjectGraphResult = {
        nodes,
        relationships: traversal.relationships,
        totals: {
          objects: nodes.length,
          relationships: traversal.relationships.length,
        },
        truncated: traversal.truncated,
        rootNodeId: `${rootDatasourceId}:${rootObjectId}`,
      };
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getGraphPaths: RequestHandler = async (req, res) => {
    const {
      sourceDatasourceId,
      sourceObjectId,
      targetDatasourceId,
      targetObjectId,
    } = req.query;
    if (typeof sourceDatasourceId !== 'string' || !isUuid(sourceDatasourceId)) {
      return res.status(400).json({ error: 'Invalid sourceDatasourceId' });
    }
    if (typeof sourceObjectId !== 'string' || sourceObjectId.length === 0) {
      return res.status(400).json({ error: 'Invalid sourceObjectId' });
    }
    if (typeof targetDatasourceId !== 'string' || !isUuid(targetDatasourceId)) {
      return res.status(400).json({ error: 'Invalid targetDatasourceId' });
    }
    if (typeof targetObjectId !== 'string' || targetObjectId.length === 0) {
      return res.status(400).json({ error: 'Invalid targetObjectId' });
    }
    if (
      sourceDatasourceId === targetDatasourceId &&
      sourceObjectId === targetObjectId
    ) {
      return res
        .status(400)
        .json({ error: 'Source and target must be different objects' });
    }
    const parsed = parseGraphTraversalFilters(req.query);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const maxDepth = parseClampedIntParam(req.query.maxDepth, {
      min: 1,
      max: OBJECT_GRAPH_PATHS_MAX_DEPTH,
      fallback: OBJECT_GRAPH_PATHS_DEFAULT_MAX_DEPTH,
    });
    if (maxDepth === undefined) {
      return res.status(400).json({ error: 'Invalid maxDepth' });
    }
    const pathLimit = parseClampedIntParam(req.query.pathLimit, {
      min: 1,
      max: OBJECT_GRAPH_PATHS_LIMIT,
      fallback: OBJECT_GRAPH_PATHS_LIMIT,
    });
    if (pathLimit === undefined) {
      return res.status(400).json({ error: 'Invalid pathLimit' });
    }

    try {
      const [sourceExists, targetExists] = await Promise.all([
        this.objectDao.checkObjectExists(
          sourceDatasourceId,
          sourceObjectId,
          this.getWorkspaceId(req),
        ),
        this.objectDao.checkObjectExists(
          targetDatasourceId,
          targetObjectId,
          this.getWorkspaceId(req),
        ),
      ]);
      if (!sourceExists) {
        return res.status(404).json({ error: 'Source object not found' });
      }
      if (!targetExists) {
        return res.status(404).json({ error: 'Target object not found' });
      }

      const { paths, truncated } = await this.relationshipDao.findPaths({
        workspaceId: this.getWorkspaceId(req),
        source: {
          datasourceId: sourceDatasourceId,
          objectId: sourceObjectId,
        },
        target: {
          datasourceId: targetDatasourceId,
          objectId: targetObjectId,
        },
        maxDepth,
        pathLimit,
        filters: parsed.filters,
      });

      const nodeRefsByKey = new Map<
        string,
        { datasourceId: string; objectId: string }
      >();
      const edgeIds = new Set<string>();
      for (const path of paths) {
        for (const node of path.nodes) {
          nodeRefsByKey.set(`${node.datasourceId}:${node.objectId}`, node);
        }
        for (const id of path.relationshipIds) {
          edgeIds.add(id);
        }
      }
      const [nodes, relationships] = await Promise.all([
        this.objectDao.queryGraphNodesByRefs(
          [...nodeRefsByKey.values()],
          this.getWorkspaceId(req),
        ),
        this.relationshipDao.getGraphRelationshipsByIds(
          [...edgeIds],
          this.getWorkspaceId(req),
        ),
      ]);

      const result: ObjectGraphPathsResult = {
        nodes,
        relationships,
        totals: {
          objects: nodes.length,
          relationships: relationships.length,
        },
        truncated,
        paths: paths.map(path => ({
          nodes: path.nodes,
          relationshipIds: path.relationshipIds,
          hops: path.hops,
        })),
      };
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  queryWithJoin: RequestHandler = async (req, res) => {
    const {
      leftDatasourceId,
      rightDatasourceId,
      leftIndexKey,
      rightIndexKey,
      rightAlias,
      limit,
      offset,
    } = req.body;

    if (
      !leftDatasourceId ||
      !rightDatasourceId ||
      !leftIndexKey ||
      !rightIndexKey ||
      !rightAlias
    ) {
      return res.status(400).json({
        error:
          'leftDatasourceId, rightDatasourceId, leftIndexKey, rightIndexKey, and rightAlias are required',
      });
    }

    if (!isUuid(leftDatasourceId) || !isUuid(rightDatasourceId)) {
      return res.status(400).json({
        error: 'leftDatasourceId and rightDatasourceId must be valid UUIDs',
      });
    }

    try {
      const result = await this.datastoreRepository.queryWithJoin({
        workspaceId: this.getWorkspaceId(req),
        leftDatasourceId,
        rightDatasourceId,
        leftIndexKey,
        rightIndexKey,
        limit: limit ? parseInt(String(limit), 10) : undefined,
        offset: offset ? parseInt(String(offset), 10) : undefined,
      });

      const items = result.items.map(({ rightMatches, ...rest }) => ({
        ...rest,
        [rightAlias]: rightMatches,
      }));

      return res.send({ items, total: result.total });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  updateDatasource: RequestHandler = async (req, res) => {
    const { items, datasourceName } = req.body;

    const datasourceId = req.params.datasourceId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }
    try {
      const delta = await this.datastoreRepository.replaceDatasourceItems(
        datasourceId,
        items,
        {
          workspaceId: this.getWorkspaceId(req),
          ...(datasourceName ? { datasourceName } : {}),
        },
      );

      return res.json({ datasourceId, ...delta });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listByDatasource: RequestHandler = async (req, res) => {
    const { limit, offset, sortByIndex, sortOrder, filter, explain } =
      req.query;

    const datasourceId = req.params.datasourceId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }
    try {
      const result = await this.objectDao.query(datasourceId, {
        workspaceId: this.getWorkspaceId(req),
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        orderBy: sortByIndex as string | undefined,
        sortOrder: sortOrder as SortOrder | undefined,
        filter: filter as Record<string, string> | undefined,
        explain: explain === 'true',
      });

      return res.send(
        await this.withContextGroups(result, this.getWorkspaceId(req)),
      );
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  addObject: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    const item = req.body;

    if (!item || !item.id || !item.objectId || !item.object) {
      return res
        .status(400)
        .json({ error: 'Invalid item: id, objectId, and object are required' });
    }

    if (!isUuid(item.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    try {
      await this.datastoreRepository.insertDatastoreItem(
        {
          ...item,
          datasourceId,
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
        },
        this.getWorkspaceId(req),
      );

      return res.status(201).send({ success: true });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  deleteAllObjects: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      const workspaceId = this.getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
      await this.objectDao.deleteAllDatastoreItems(datasourceId, workspaceId);
      await this.schemaDao.deleteDatasourceSchemas(datasourceId, workspaceId);

      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getObject: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    const objectId = req.params.objectId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      const result = await this.objectDao.getDatastoreItem(
        datasourceId,
        objectId,
        this.getWorkspaceId(req),
      );

      if (!result) {
        return res.status(404).json({ error: 'Object not found' });
      }

      const relationships =
        await this.relationshipDao.getRelationshipsForObject(
          datasourceId,
          objectId,
          this.getWorkspaceId(req),
        );

      return res.send({ ...result, relationships });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  deleteObject: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    const objectId = req.params.objectId;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      await this.objectDao.deleteDatastoreItem(
        datasourceId,
        objectId,
        this.getWorkspaceId(req),
      );

      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}
