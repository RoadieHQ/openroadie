import { Router, RequestHandler, json, Request } from 'express';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import type { GraphEdgeOriginFilter } from '@roadiehq/catalog-datastore-common';
import { ObjectDao, RelationshipDao } from '../../database';
import { validate as isUuid } from 'uuid';
import { callerPrincipal, HttpAuthService } from '@roadiehq/extensions-api';
import { parseCsvStringsParam, parseCsvUuidsParam } from '../utils';
import type { DatasourceEvents } from '../../webhooks/DatasourceEvents';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

export class RelationshipsController {
  private objectDao: ObjectDao;
  private relationshipDao: RelationshipDao;
  private httpAuth: HttpAuthService;
  private scopeService: ScopeService;
  private events?: DatasourceEvents;
  private getWorkspaceId: (req: Request) => string | undefined;

  constructor(opts: {
    objectDao: ObjectDao;
    relationshipDao: RelationshipDao;
    httpAuth: HttpAuthService;
    scopeService: ScopeService;
    events?: DatasourceEvents;
    getWorkspaceId?: (req: Request) => string | undefined;
  }) {
    this.objectDao = opts.objectDao;
    this.relationshipDao = opts.relationshipDao;
    this.httpAuth = opts.httpAuth;
    this.scopeService = opts.scopeService;
    this.events = opts.events;
    this.getWorkspaceId = opts.getWorkspaceId ?? (() => undefined);
  }

  // Context groups merge members across edges, so direct edge writes must
  // re-materialize them — same contract as the rule-driven writes in
  // DatastoreRepository.
  private notifyRelationshipsChanged(
    datasourceIds: string[],
    workspaceId: string,
  ): void {
    for (const datasourceId of new Set(datasourceIds)) {
      this.events?.emitRelationshipsChanged(datasourceId, workspaceId);
    }
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;

    router
      .route('/bulk')
      .put(requireScopes(SCOPES.relationship.create), json(), this.upsertBulk);

    // Literal routes must precede `/:id`, which would otherwise swallow
    // them and 400 on the uuid check.
    router.get(
      '/summary',
      requireScopes(SCOPES.relationship.query),
      this.getSummary,
    );

    router
      .route('/types')
      .get(
        requireScopes(SCOPES.relationship.query),
        this.listAllRelationshipTypes,
      );

    router
      .route('/types/:datasourceId')
      .get(
        requireScopes(SCOPES.relationship.query),
        this.listRelationshipTypes,
      );

    router
      .route('/source/:datasourceId/:objectId')
      .get(requireScopes(SCOPES.relationship.query), this.queryBySource)
      .delete(requireScopes(SCOPES.relationship.delete), this.deleteBySource);

    router
      .route('/destination/:datasourceId/:objectId')
      .get(requireScopes(SCOPES.relationship.query), this.queryByDestination)
      .delete(
        requireScopes(SCOPES.relationship.delete),
        this.deleteByDestination,
      );

    router
      .route('/:id')
      .get(requireScopes(SCOPES.relationship.get), this.getRelationship)
      .delete(
        requireScopes(SCOPES.relationship.delete),
        this.deleteRelationship,
      );

    router
      .route('/')
      .get(requireScopes(SCOPES.relationship.query), this.queryAll)
      .put(
        requireScopes(SCOPES.relationship.create),
        json(),
        this.upsertSingle,
      );

    return router;
  }

  private async getUserId(req: Request): Promise<string | undefined> {
    return (await callerPrincipal(this.httpAuth, req))?.userId;
  }

  getSummary: RequestHandler = async (req, res) => {
    const datasourceIds = parseCsvUuidsParam(req.query.datasourceIds);
    if (!datasourceIds.ok) {
      return res.status(400).json({ error: 'Invalid datasourceIds' });
    }
    const origin = req.query.origin as GraphEdgeOriginFilter | undefined;
    if (origin !== undefined && origin !== 'rule' && origin !== 'direct') {
      return res.status(400).json({ error: 'Invalid origin' });
    }

    try {
      const result = await this.relationshipDao.summarizeGraphEdges({
        workspaceId: this.getWorkspaceId(req),
        datasourceIds: datasourceIds.ids,
        relationshipTypes: parseCsvStringsParam(req.query.relationshipTypes),
        origin,
      });
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listAllRelationshipTypes: RequestHandler = async (req, res) => {
    const datasourceIds = parseCsvUuidsParam(req.query.datasourceIds);
    if (!datasourceIds.ok) {
      return res.status(400).json({ error: 'Invalid datasourceIds' });
    }

    try {
      const items = await this.relationshipDao.listRelationshipTypes({
        workspaceId: this.getWorkspaceId(req),
        datasourceIds: datasourceIds.ids,
      });
      return res.status(200).json({ items });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  queryAll: RequestHandler = async (req, res) => {
    const { relationshipType, limit, offset, origin, ruleId, direct } =
      req.query;

    try {
      const result = await this.relationshipDao.queryAll({
        workspaceId: this.getWorkspaceId(req),
        relationshipType: relationshipType as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        origin: origin as string | undefined,
        ruleId: ruleId as string | undefined,
        direct: direct === 'true' ? true : undefined,
      });
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  upsertSingle: RequestHandler = async (req, res) => {
    const {
      sourceDatasourceId,
      sourceObjectId,
      destinationDatasourceId,
      destinationObjectId,
      relationshipType,
      reciprocalRelationshipType,
      origin,
      metadata,
    } = req.body;

    if (
      !sourceDatasourceId ||
      !sourceObjectId ||
      !destinationDatasourceId ||
      !destinationObjectId ||
      !relationshipType
    ) {
      return res.status(400).json({
        error:
          'sourceDatasourceId, sourceObjectId, destinationDatasourceId, destinationObjectId, and relationshipType are required',
      });
    }

    if (!isUuid(sourceDatasourceId)) {
      return res
        .status(400)
        .json({ error: 'Invalid sourceDatasourceId format' });
    }
    if (!isUuid(destinationDatasourceId)) {
      return res
        .status(400)
        .json({ error: 'Invalid destinationDatasourceId format' });
    }

    try {
      const sourceExists = await this.objectDao.checkObjectExists(
        sourceDatasourceId,
        sourceObjectId,
        this.getWorkspaceId(req),
      );
      if (!sourceExists) {
        return res.status(400).json({ error: 'Source object does not exist' });
      }

      const destinationExists = await this.objectDao.checkObjectExists(
        destinationDatasourceId,
        destinationObjectId,
        this.getWorkspaceId(req),
      );
      if (!destinationExists) {
        return res
          .status(400)
          .json({ error: 'Destination object does not exist' });
      }

      const updatedBy = await this.getUserId(req);
      const result = await this.relationshipDao.upsertRelationship(
        {
          sourceDatasourceId,
          sourceObjectId,
          destinationDatasourceId,
          destinationObjectId,
          relationshipType,
          reciprocalRelationshipType,
          origin,
          metadata,
          updatedBy,
        },
        this.getWorkspaceId(req),
      );
      this.notifyRelationshipsChanged(
        [sourceDatasourceId, destinationDatasourceId],
        this.getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID,
      );

      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  upsertBulk: RequestHandler = async (req, res) => {
    const { relationships } = req.body;

    if (!Array.isArray(relationships) || relationships.length === 0) {
      return res
        .status(400)
        .json({ error: 'relationships must be a non-empty array' });
    }

    for (const relationship of relationships) {
      if (
        !relationship.sourceDatasourceId ||
        !relationship.sourceObjectId ||
        !relationship.destinationDatasourceId ||
        !relationship.destinationObjectId ||
        !relationship.relationshipType
      ) {
        return res.status(400).json({
          error:
            'Each relationship must have sourceDatasourceId, sourceObjectId, destinationDatasourceId, destinationObjectId, and relationshipType',
        });
      }
      if (!isUuid(relationship.sourceDatasourceId)) {
        return res
          .status(400)
          .json({ error: 'Invalid sourceDatasourceId format' });
      }
      if (!isUuid(relationship.destinationDatasourceId)) {
        return res
          .status(400)
          .json({ error: 'Invalid destinationDatasourceId format' });
      }
    }

    try {
      const objectsToCheck = new Map<string, Set<string>>();
      for (const relationship of relationships) {
        const srcSet =
          objectsToCheck.get(relationship.sourceDatasourceId) ??
          new Set<string>();
        srcSet.add(relationship.sourceObjectId);
        objectsToCheck.set(relationship.sourceDatasourceId, srcSet);

        const destSet =
          objectsToCheck.get(relationship.destinationDatasourceId) ??
          new Set<string>();
        destSet.add(relationship.destinationObjectId);
        objectsToCheck.set(relationship.destinationDatasourceId, destSet);
      }

      for (const [datasourceId, objectIds] of objectsToCheck) {
        for (const objectId of objectIds) {
          const exists = await this.objectDao.checkObjectExists(
            datasourceId,
            objectId,
            this.getWorkspaceId(req),
          );
          if (!exists) {
            return res.status(400).json({
              error: `Object ${objectId} in datasource ${datasourceId} does not exist`,
            });
          }
        }
      }

      const updatedBy = await this.getUserId(req);
      const inputs = relationships.map(
        (r: {
          sourceDatasourceId: string;
          sourceObjectId: string;
          destinationDatasourceId: string;
          destinationObjectId: string;
          relationshipType: string;
        }) => ({
          ...r,
          updatedBy,
        }),
      );

      const result = await this.relationshipDao.upsertRelationships(
        inputs,
        this.getWorkspaceId(req),
      );
      this.notifyRelationshipsChanged(
        [...objectsToCheck.keys()],
        this.getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID,
      );
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getRelationship: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid relationship ID format' });
    }

    try {
      const result = await this.relationshipDao.getRelationship(
        id,
        this.getWorkspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Relationship not found' });
      }
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  deleteRelationship: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid relationship ID format' });
    }

    try {
      const existing = await this.relationshipDao.getRelationship(
        id,
        this.getWorkspaceId(req),
      );
      await this.relationshipDao.deleteRelationship(
        id,
        this.getWorkspaceId(req),
      );
      if (existing) {
        this.notifyRelationshipsChanged(
          [existing.sourceDatasourceId, existing.destinationDatasourceId],
          this.getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID,
        );
      }
      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  queryBySource: RequestHandler = async (req, res) => {
    const { datasourceId, objectId } = req.params;
    const { relationshipType, limit, offset, origin, ruleId, direct } =
      req.query;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      const result = await this.relationshipDao.queryRelationshipsBySource(
        datasourceId,
        objectId,
        {
          workspaceId: this.getWorkspaceId(req),
          relationshipType: relationshipType as string | undefined,
          limit: limit ? parseInt(limit as string, 10) : undefined,
          offset: offset ? parseInt(offset as string, 10) : undefined,
          origin: origin as string | undefined,
          ruleId: ruleId as string | undefined,
          direct: direct === 'true' ? true : undefined,
        },
      );
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  deleteBySource: RequestHandler = async (req, res) => {
    const { datasourceId, objectId } = req.params;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      await this.relationshipDao.deleteRelationshipsBySource(
        datasourceId,
        objectId,
        this.getWorkspaceId(req),
      );
      // One endpoint datasource is enough: a context rule can only merge on
      // an edge whose two datasources are both in the rule, so the rule is
      // discoverable from either side.
      this.notifyRelationshipsChanged(
        [datasourceId],
        this.getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID,
      );
      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  queryByDestination: RequestHandler = async (req, res) => {
    const { datasourceId, objectId } = req.params;
    const { relationshipType, limit, offset, origin, ruleId, direct } =
      req.query;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      const result = await this.relationshipDao.queryRelationshipsByDestination(
        datasourceId,
        objectId,
        {
          workspaceId: this.getWorkspaceId(req),
          relationshipType: relationshipType as string | undefined,
          limit: limit ? parseInt(limit as string, 10) : undefined,
          offset: offset ? parseInt(offset as string, 10) : undefined,
          origin: origin as string | undefined,
          ruleId: ruleId as string | undefined,
          direct: direct === 'true' ? true : undefined,
        },
      );
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  deleteByDestination: RequestHandler = async (req, res) => {
    const { datasourceId, objectId } = req.params;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      await this.relationshipDao.deleteRelationshipsByDestination(
        datasourceId,
        objectId,
        this.getWorkspaceId(req),
      );
      this.notifyRelationshipsChanged(
        [datasourceId],
        this.getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID,
      );
      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listRelationshipTypes: RequestHandler = async (req, res) => {
    const { datasourceId } = req.params;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      const types =
        await this.relationshipDao.listRelationshipTypesByDatasource(
          datasourceId,
          this.getWorkspaceId(req),
        );
      return res.status(200).json({ items: types });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}
