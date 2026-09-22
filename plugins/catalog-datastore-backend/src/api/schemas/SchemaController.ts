import { Router, Request, RequestHandler } from 'express';
import type { LoggerService } from '@roadiehq/extensions-api';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import {
  SchemaDao,
  ObjectDao,
  RelationshipRuleDao,
  SuggestionVerdictDao,
} from '../../database';
import { validate as isUuid } from 'uuid';
import {
  CatalogWorkflowClient,
  NODE_TYPES,
} from '@roadiehq/catalog-workflow-common';
import { parsePositiveInt } from '../utils';
import {
  buildSuggestions,
  capSuggestionsByUnorderedPair,
  groupSuggestionsByPair,
  persistNewRules,
} from './suggestRelationshipsService';
import { SuggestionCorpusCache } from './suggestionCorpus';
import {
  computeCalibration,
  IDENTITY_CALIBRATION,
  type ScoreCalibration,
} from './scoreCalibration';

/**
 * Upper bound on how many gate-suppressed candidates either Generate
 * endpoint returns per datasource. Suppressed candidates are review noise,
 * not the primary result — this caps response size without needing the
 * pipeline itself to limit how much evidence it computes.
 */
export const SUPPRESSED_RESPONSE_CAP = 50;

export class SchemaController {
  private schemaDao: SchemaDao;
  private objectDao: ObjectDao;
  private relationshipRuleDao: RelationshipRuleDao;
  private catalogWorkflowClient: CatalogWorkflowClient;
  private scopeService: ScopeService;
  private suggestionVerdictDao: SuggestionVerdictDao;
  private logger?: LoggerService;
  private getWorkspaceId: (req: Request) => string | undefined;

  constructor(opts: {
    schemaDao: SchemaDao;
    objectDao: ObjectDao;
    relationshipRuleDao: RelationshipRuleDao;
    catalogWorkflowClient: CatalogWorkflowClient;
    scopeService: ScopeService;
    suggestionVerdictDao: SuggestionVerdictDao;
    logger?: LoggerService;
    getWorkspaceId?: (req: Request) => string | undefined;
  }) {
    this.schemaDao = opts.schemaDao;
    this.objectDao = opts.objectDao;
    this.relationshipRuleDao = opts.relationshipRuleDao;
    this.catalogWorkflowClient = opts.catalogWorkflowClient;
    this.scopeService = opts.scopeService;
    this.suggestionVerdictDao = opts.suggestionVerdictDao;
    this.logger = opts.logger;
    this.getWorkspaceId = opts.getWorkspaceId ?? (() => undefined);
  }

  // Calibration is telemetry-derived (see RelationshipRulesController's
  // verdict-append: "verdicts are telemetry for calibration — never fail the
  // transition"). The read side must honor the same contract: a corrupt
  // verdict row (a bad JSON blob, a non-Postgres dialect's row mapper) must
  // never break Generate. Degrade to identity calibration on any failure.
  private async resolveCalibration(
    workspaceId?: string,
  ): Promise<ScoreCalibration> {
    try {
      const verdicts =
        await this.suggestionVerdictDao.listVerdictsForCalibration(workspaceId);
      return computeCalibration(verdicts);
    } catch (e: unknown) {
      // Warn so a real fit/read bug is distinguishable from the ordinary
      // "not enough labels yet" case (which never throws — it returns identity
      // from computeCalibration). Still degrade to identity: calibration must
      // never fail Generate.
      this.logger?.warn(
        `Calibration failed; falling back to identity calibration: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return IDENTITY_CALIBRATION;
    }
  }

  /**
   * Lists every enabled workflow, paging past the server's default page size
   * (50). Without this, datasource #51+ is silently treated as disabled:
   * single-datasource Generate 409s and batch Generate drops its suggestions.
   */
  private async listAllEnabledWorkflows(workspaceId?: string) {
    const limit = 200;
    const workflows = [];
    for (let offset = 0; ; offset += limit) {
      const { data } = await this.catalogWorkflowClient.list({
        enabled: true,
        limit,
        offset,
        workspaceId,
      });
      workflows.push(...data);
      if (data.length < limit) {
        break;
      }
    }
    return workflows;
  }

  /**
   * Fetches the enabled workflow list once and derives both views a Generate
   * run needs from it: the id set (scope/gating) and the id → name map fed
   * to `buildSuggestions` as `datasourceNamesById`, which drives
   * name-similarity's container-aware matching.
   */
  private async resolveEnabledDatasources(workspaceId?: string): Promise<{
    ids: Set<string>;
    namesById: Record<string, string>;
  }> {
    const workflows = await this.listAllEnabledWorkflows(workspaceId);
    return {
      ids: new Set(workflows.map(w => w.id)),
      // `typeof` guard rather than trusting the WorkflowDefinition type: a
      // name-less workflow reaching nameSimilarity's tokenizer would crash on
      // `undefined.replace`, so a malformed entry is dropped from the map
      // instead of ever synthesizing a name for it.
      namesById: Object.fromEntries(
        workflows
          .filter((w): w is typeof w & { name: string } => Boolean(w.name))
          .map(w => [w.id, w.name]),
      ),
    };
  }

  private async getIntegrationIdMap(
    workspaceId?: string,
  ): Promise<Map<string, string>> {
    const workflows = await this.listAllEnabledWorkflows(workspaceId);
    const map = new Map<string, string>();
    for (const workflow of workflows) {
      const sourceNode = workflow.nodes.find(
        n => n.type === NODE_TYPES.SOURCE_INTEGRATION,
      );
      const integrationId = sourceNode?.data?.config?.integrationId;
      if (typeof integrationId === 'string') {
        map.set(workflow.id, integrationId);
      }
    }
    return map;
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;
    router.get(
      '/',
      requireScopes(SCOPES.catalogDatastore.query),
      this.listDatasources,
    );
    router.get(
      '/:datasourceId/latest',
      requireScopes(SCOPES.catalogDatastore.get),
      this.getLatest,
    );
    router.get(
      '/:datasourceId',
      requireScopes(SCOPES.catalogDatastore.get),
      this.listVersions,
    );
    // Generate persists `suggested` rules and runs the stale sweep — a write, even
    // though it sits on the schemas router.
    router.post(
      '/suggest-relationships',
      requireScopes(SCOPES.relationshipRule.create),
      this.suggestRelationshipsBatch,
    );
    router.post(
      '/:datasourceId/suggest-relationships',
      requireScopes(SCOPES.relationshipRule.create),
      this.suggestRelationships,
    );
    return router;
  }

  listDatasources: RequestHandler = async (req, res) => {
    const { limit, offset } = req.query;
    try {
      const result = await this.schemaDao.listDatasourceSchemas({
        workspaceId: this.getWorkspaceId(req),
        limit: parsePositiveInt(limit),
        offset: parsePositiveInt(offset),
      });
      const integrationMap = await this.getIntegrationIdMap(
        this.getWorkspaceId(req),
      );
      const items = result.items.map(schema => {
        const integrationId = integrationMap.get(schema.datasourceId);
        return integrationId ? { ...schema, integrationId } : schema;
      });
      return res.send({ ...result, items });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
  };

  getLatest: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }
    try {
      const schema = await this.schemaDao.getLatestSchema(
        datasourceId,
        this.getWorkspaceId(req),
      );
      if (!schema) {
        return res.status(404).json({ error: 'No schema found' });
      }
      const integrationMap = await this.getIntegrationIdMap(
        this.getWorkspaceId(req),
      );
      const integrationId = integrationMap.get(datasourceId);
      return res.send(integrationId ? { ...schema, integrationId } : schema);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
  };

  listVersions: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    const { limit, offset } = req.query;
    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }
    try {
      const result = await this.schemaDao.listSchemaVersions(datasourceId, {
        workspaceId: this.getWorkspaceId(req),
        limit: parsePositiveInt(limit),
        offset: parsePositiveInt(offset),
      });
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
  };

  suggestRelationshipsBatch: RequestHandler = async (req, res) => {
    const { datasourceIds } = req.body;
    if (
      !Array.isArray(datasourceIds) ||
      datasourceIds.length === 0 ||
      !datasourceIds.every(isUuid)
    ) {
      return res
        .status(400)
        .json({ error: 'datasourceIds must be a non-empty array of UUIDs' });
    }
    try {
      const workspaceId = this.getWorkspaceId(req);
      const { ids: enabledIds, namesById: datasourceNamesById } =
        await this.resolveEnabledDatasources(workspaceId);
      // Deduplicate before the pair guard: a request repeating one enabled id
      // ([X, X]) would otherwise pass the length check and filter itself down
      // to zero targets per source.
      const activeIds = [...new Set<string>(datasourceIds)].filter(id =>
        enabledIds.has(id),
      );
      // The run is scoped to the pairs within `activeIds`: fewer than two
      // means nothing to pair. Short-circuit rather than calling
      // buildSuggestions with an empty target list per source — same result,
      // no wasted sampling.
      if (activeIds.length < 2) {
        return res.send({
          results: activeIds.map((id: string) => ({
            datasourceId: id,
            total: 0,
            suggestions: [],
          })),
          pairs: [],
          createdRules: [],
        });
      }

      // One corpus cache for the whole run: each datasource is sampled and
      // profiled once, however many pairings it participates in.
      const corpusCache = new SuggestionCorpusCache(
        this.objectDao,
        workspaceId,
      );
      const calibration = await this.resolveCalibration(workspaceId);
      const perSourceResults = await Promise.all(
        activeIds.map((id: string) =>
          buildSuggestions(
            this.objectDao,
            id,
            activeIds.filter((d: string) => d !== id),
            corpusCache,
            datasourceNamesById,
            calibration,
            workspaceId,
          ),
        ),
      );
      // Each source's resolve capped its own direction; a batch evaluates both
      // directions of a pair, so enforce PAIR_PERSIST_CAP once more across the
      // combined set before persisting/grouping — otherwise an unordered pair
      // persists up to 2× the cap.
      const results = capSuggestionsByUnorderedPair(perSourceResults);
      // Persistence and staling are scoped to what this run actually
      // evaluated. Passing the full enabled set here would let a
      // subset-scoped run auto-stale suggestions targeting datasources it
      // never looked at.
      const evaluatedIds = new Set<string>(activeIds);
      const createdRules = await persistNewRules(
        this.relationshipRuleDao,
        results,
        evaluatedIds,
        workspaceId,
      );
      return res.send({
        results: results.map(result => ({
          datasourceId: result.datasourceId,
          total: result.total,
          suggestions: result.suggestions,
          suppressedSuggestions: result.suppressedSuggestions.slice(
            0,
            SUPPRESSED_RESPONSE_CAP,
          ),
        })),
        pairs: groupSuggestionsByPair(results),
        createdRules,
      });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
  };

  suggestRelationships: RequestHandler = async (req, res) => {
    const datasourceId = req.params.datasourceId;
    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }
    try {
      const workspaceId = this.getWorkspaceId(req);
      const { ids: enabledIds, namesById: datasourceNamesById } =
        await this.resolveEnabledDatasources(workspaceId);
      if (!enabledIds.has(datasourceId)) {
        return res.status(409).json({
          error: 'Datasource is disabled',
        });
      }
      const targetIds = [...enabledIds].filter(id => id !== datasourceId);
      const calibration = await this.resolveCalibration(workspaceId);
      const result = await buildSuggestions(
        this.objectDao,
        datasourceId,
        targetIds,
        undefined,
        datasourceNamesById,
        calibration,
        workspaceId,
      );
      const createdRules = await persistNewRules(
        this.relationshipRuleDao,
        [result],
        enabledIds,
        workspaceId,
      );
      return res.send({
        total: result.total,
        suggestions: result.suggestions,
        suppressedSuggestions: result.suppressedSuggestions.slice(
          0,
          SUPPRESSED_RESPONSE_CAP,
        ),
        createdRules,
      });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
  };
}
