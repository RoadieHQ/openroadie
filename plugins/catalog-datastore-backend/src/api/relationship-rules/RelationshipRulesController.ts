import express, { Router, RequestHandler, json } from 'express';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import {
  RelationshipRuleDao,
  RelationshipDao,
  DatastoreRepository,
  ObjectDao,
  SchemaDao,
  SuggestionVerdictDao,
  type SuggestionVerdictAction,
} from '../../database';
import { validate as isUuid } from 'uuid';
import type {
  RelationshipRule,
  RelationshipRuleMatchStrategy,
  RelationshipRuleState,
} from '@roadiehq/catalog-datastore-common';
import {
  RELATIONSHIP_RULE_STRATEGIES,
  isRelationshipRuleStrategy,
  buildInverseMap,
  findInverses,
  splitSuggestedRuleBulkApprove,
  isRelationshipRuleState,
  relationshipRuleStatePath,
  STATE_AFTER_TRANSITION,
  type RelationshipRuleTransition,
} from '@roadiehq/catalog-datastore-common';
import { inferExampleRelationshipPattern } from './inferExamplePattern';
import { isGeneratorOwnedRule } from '../schemas/suggestRelationshipsService';
import { serializeCaughtError } from '../utils';
import {
  HttpAuthService,
  LoggerService,
  callerAttribution,
  callerPrincipal,
} from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

const MATCH_STRATEGIES: ReadonlyArray<RelationshipRuleMatchStrategy> = [
  'exact',
  'contains',
  'array_contains',
  'regex',
  'person_name_alias',
];
const isMatchStrategy = (
  value: unknown,
): value is RelationshipRuleMatchStrategy =>
  typeof value === 'string' &&
  (MATCH_STRATEGIES as readonly string[]).includes(value);

/**
 * One page wide enough to hold every rule in a single state in a real catalog.
 * Used for both scans the inverse pairing needs: the `suggested` snapshot a bulk
 * approve is computed from, and the `active` set the mirror guard checks against.
 *
 * It is a ceiling, not a guarantee. A catalog with more rules than this in one
 * state leaves the tail unread, so a mirror living past the cut goes unseen and
 * both directions of an edge could end up active. Page the scan if that ever
 * becomes reachable rather than raising the number indefinitely.
 */
const RULE_STATE_SCAN_PAGE = 10000;

/**
 * The mirror of `rule` among `candidates`, or undefined. The single place the
 * pairing is spelled out — both approve paths route through it.
 *
 * Takes the rule itself rather than relying on it being in `candidates`: on an
 * approve its state is already `active` by the time the suggested set is read,
 * and `buildInverseMap` needs both sides of the pair present.
 */
function findInverseAmong(
  rule: RelationshipRule,
  candidates: RelationshipRule[],
): RelationshipRule | undefined {
  const others = candidates.filter(item => item.id !== rule.id);
  return buildInverseMap([rule, ...others]).get(rule.id);
}

/**
 * The verdict each transition records for calibration. `disable` has none: it
 * acts on an already-approved rule, so it is not a review of a suggestion.
 */
const VERDICT_FOR_TRANSITION: Record<
  RelationshipRuleTransition,
  SuggestionVerdictAction | undefined
> = {
  approve: 'approve',
  dismiss: 'dismiss',
  reset: 'reset',
  disable: undefined,
};

const REPLACE_REQUIRED_RULE_FIELDS = [
  'name',
  'sourceDatasourceId',
  'targetDatasourceId',
  'sourceFieldExpression',
  'targetFieldExpression',
  'relationshipType',
] as const;

/** Result of one hop of the state machine — see `runTransition`. */
type TransitionOutcome =
  | { ok: true; rule: RelationshipRule }
  | { ok: false; status: number; error: string };

export class RelationshipRulesController {
  private relationshipRuleDao: RelationshipRuleDao;
  private relationshipDao: RelationshipDao;
  private datastoreRepository: DatastoreRepository;
  private objectDao?: ObjectDao;
  private schemaDao?: SchemaDao;
  private httpAuth: HttpAuthService;
  private scopeService: ScopeService;
  private suggestionVerdictDao: SuggestionVerdictDao;
  private logger?: LoggerService;
  private getWorkspaceId: (req: express.Request) => string;

  constructor(opts: {
    relationshipRuleDao: RelationshipRuleDao;
    relationshipDao: RelationshipDao;
    datastoreRepository: DatastoreRepository;
    objectDao?: ObjectDao;
    schemaDao?: SchemaDao;
    httpAuth: HttpAuthService;
    scopeService: ScopeService;
    suggestionVerdictDao: SuggestionVerdictDao;
    logger?: LoggerService;
    getWorkspaceId?: (req: express.Request) => string;
  }) {
    this.relationshipRuleDao = opts.relationshipRuleDao;
    this.relationshipDao = opts.relationshipDao;
    this.datastoreRepository = opts.datastoreRepository;
    this.objectDao = opts.objectDao;
    this.schemaDao = opts.schemaDao;
    this.httpAuth = opts.httpAuth;
    this.scopeService = opts.scopeService;
    this.suggestionVerdictDao = opts.suggestionVerdictDao;
    this.logger = opts.logger;
    this.getWorkspaceId = opts.getWorkspaceId ?? (() => DEFAULT_WORKSPACE_ID);
  }

  private async getUserId(req: express.Request): Promise<string | undefined> {
    return (await callerPrincipal(this.httpAuth, req))?.userId;
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;

    // Guarded by `integration:delete` rather than `relationshipRule.query`: it
    // answers "may this integration be deleted" and returns nothing but
    // integration usage, so the authority it needs is the authority to delete
    // one. Without that, a token narrowed to `integration:delete` could never
    // complete a delete.
    router
      .route('/integration-usage/:integrationId')
      .get(requireScopes(SCOPES.integration.delete), this.integrationUsage);

    router
      .route('/preview')
      .post(
        requireScopes(SCOPES.relationshipRule.dryRun),
        json(),
        this.previewRule,
      );

    router
      .route('/infer-example-pattern')
      .post(
        requireScopes(SCOPES.relationshipRule.query),
        json(),
        this.inferExamplePattern,
      );

    router
      .route('/approve')
      .post(
        requireScopes(SCOPES.relationshipRule.execute),
        json(),
        this.bulkApproveRules,
      );

    router
      .route('/:id/approve')
      .post(
        requireScopes(SCOPES.relationshipRule.execute),
        json(),
        this.approveRule,
      );

    router
      .route('/:id/dismiss')
      .post(
        requireScopes(SCOPES.relationshipRule.execute),
        json(),
        this.dismissRule,
      );

    router
      .route('/:id/disable')
      .post(requireScopes(SCOPES.relationshipRule.execute), this.disableRule);

    router
      .route('/:id/reset')
      .post(
        requireScopes(SCOPES.relationshipRule.execute),
        json(),
        this.resetRule,
      );

    router
      .route('/:id/state')
      .put(
        requireScopes(SCOPES.relationshipRule.execute),
        json(),
        this.setRuleState,
      );

    router
      .route('/:id/apply')
      .post(requireScopes(SCOPES.relationshipRule.execute), this.applyRule);

    router
      .route('/:id/dry-run')
      .post(requireScopes(SCOPES.relationshipRule.dryRun), this.dryRunRule);

    router
      .route('/:id/relationships')
      .get(
        requireScopes(SCOPES.relationshipRule.query),
        this.listRelationshipsByRule,
      );

    router
      .route('/:id')
      .get(requireScopes(SCOPES.relationshipRule.get), this.getRule)
      .put(
        requireScopes(SCOPES.relationshipRule.create),
        json(),
        this.replaceRule,
      )
      .patch(
        requireScopes(SCOPES.relationshipRule.create),
        json(),
        this.updateRule,
      )
      .delete(requireScopes(SCOPES.relationshipRule.delete), this.deleteRule);

    router
      .route('/')
      .get(requireScopes(SCOPES.relationshipRule.query), this.listRules)
      .post(
        requireScopes(SCOPES.relationshipRule.create),
        json(),
        this.createRule,
      );

    return router;
  }

  /**
   * Integration-backed relationship rules referencing an integration, for the
   * integration delete guard.
   */
  integrationUsage: RequestHandler = async (req, res) => {
    try {
      const items = await this.relationshipRuleDao.findByIntegrationId(
        req.params.integrationId,
        this.getWorkspaceId(req),
      );
      return res.status(200).json({ items });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listRules: RequestHandler = async (req, res) => {
    const { limit, offset, origin, state, reviewReason } = req.query;
    try {
      const result = await this.relationshipRuleDao.listRelationshipRules({
        workspaceId: this.getWorkspaceId(req),
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        origin: origin as string | undefined,
        state: state as string | undefined,
        reviewReason: reviewReason as string | undefined,
      });
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  createRule: RequestHandler = async (req, res) => {
    const {
      name,
      description,
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression,
      targetFieldExpression,
      sourceFilterExpression,
      targetFilterExpression,
      relationshipType,
      reciprocalRelationshipType,
      strategy,
      matchStrategy,
      integrationConfig,
      origin,
      state,
    } = req.body;

    if (
      !name ||
      !sourceDatasourceId ||
      !targetDatasourceId ||
      !sourceFieldExpression ||
      !targetFieldExpression ||
      !relationshipType
    ) {
      return res.status(400).json({
        error:
          'name, sourceDatasourceId, targetDatasourceId, sourceFieldExpression, targetFieldExpression, and relationshipType are required',
      });
    }

    if (state !== undefined && state !== 'active' && state !== 'suggested') {
      return res.status(400).json({
        error: `Invalid state: ${String(state)}. On create, expected 'active' or 'suggested'.`,
      });
    }

    if (strategy !== undefined && !isRelationshipRuleStrategy(strategy)) {
      return res.status(400).json({
        error: `Invalid strategy: ${String(strategy)}. Expected one of ${RELATIONSHIP_RULE_STRATEGIES.join(', ')}`,
      });
    }

    const MAX_EXPRESSION_LENGTH = 500;
    if (
      sourceFieldExpression.length > MAX_EXPRESSION_LENGTH ||
      targetFieldExpression.length > MAX_EXPRESSION_LENGTH
    ) {
      return res.status(400).json({
        error: `Field expressions must be ${MAX_EXPRESSION_LENGTH} characters or fewer`,
      });
    }

    const MAX_RELATIONSHIP_TYPE_LENGTH = 200;
    if (
      relationshipType.length > MAX_RELATIONSHIP_TYPE_LENGTH ||
      (reciprocalRelationshipType &&
        reciprocalRelationshipType.length > MAX_RELATIONSHIP_TYPE_LENGTH)
    ) {
      return res.status(400).json({
        error: `Relationship types must be ${MAX_RELATIONSHIP_TYPE_LENGTH} characters or fewer`,
      });
    }

    if (!isUuid(sourceDatasourceId)) {
      return res
        .status(400)
        .json({ error: 'Invalid sourceDatasourceId format' });
    }
    if (!isUuid(targetDatasourceId)) {
      return res
        .status(400)
        .json({ error: 'Invalid targetDatasourceId format' });
    }

    try {
      const userId = await this.getUserId(req);
      // User-authored rules carry the user; only service callers (no user
      // identity) may declare an origin such as 'seed', so a user can't spoof it.
      const ruleOrigin = userId ?? (origin as string | undefined);
      const result = await this.relationshipRuleDao.createRelationshipRule(
        {
          name,
          description,
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression,
          targetFieldExpression,
          sourceFilterExpression,
          targetFilterExpression,
          relationshipType,
          reciprocalRelationshipType,
          strategy,
          matchStrategy,
          integrationConfig,
        },
        {
          workspaceId: this.getWorkspaceId(req),
          origin: ruleOrigin,
          ...(state ? { state: state as RelationshipRuleState } : {}),
        },
      );
      return res.status(201).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getRule: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    try {
      const result = await this.relationshipRuleDao.getRelationshipRule(
        id,
        this.getWorkspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Rule not found' });
      }
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  replaceRule: RequestHandler = async (req, res, next) => {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }
    const body = req.body ?? {};
    const missing = REPLACE_REQUIRED_RULE_FIELDS.filter(
      field => !body[`${field}`],
    );
    if (missing.length > 0) {
      return res.status(400).json({
        error: `${missing.join(', ')} ${
          missing.length === 1 ? 'is' : 'are'
        } required (PUT replaces the whole rule; use PATCH to change one field)`,
      });
    }
    // `state` moves through `PUT /:id/state`, not here.
    const { state: _state, ...rest } = body;
    req.body = {
      ...rest,
      description: body.description ?? null,
      sourceFilterExpression: body.sourceFilterExpression ?? null,
      targetFilterExpression: body.targetFilterExpression ?? null,
      reciprocalRelationshipType: body.reciprocalRelationshipType ?? null,
      integrationConfig: body.integrationConfig ?? null,
      strategy: body.strategy ?? 'field-matching',
      matchStrategy: body.matchStrategy ?? 'exact',
    };
    return this.updateRule(req, res, next);
  };

  updateRule: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    const {
      name,
      description,
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression,
      targetFieldExpression,
      sourceFilterExpression,
      targetFilterExpression,
      relationshipType,
      reciprocalRelationshipType,
      strategy,
      matchStrategy,
      integrationConfig,
    } = req.body;

    if (sourceDatasourceId && !isUuid(sourceDatasourceId)) {
      return res
        .status(400)
        .json({ error: 'Invalid sourceDatasourceId format' });
    }
    if (targetDatasourceId && !isUuid(targetDatasourceId)) {
      return res
        .status(400)
        .json({ error: 'Invalid targetDatasourceId format' });
    }

    if (strategy !== undefined && !isRelationshipRuleStrategy(strategy)) {
      return res.status(400).json({
        error: `Invalid strategy: ${String(strategy)}. Expected one of ${RELATIONSHIP_RULE_STRATEGIES.join(', ')}`,
      });
    }

    try {
      const result = await this.relationshipRuleDao.updateRelationshipRule(
        id,
        {
          name,
          description,
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression,
          targetFieldExpression,
          sourceFilterExpression,
          targetFilterExpression,
          relationshipType,
          reciprocalRelationshipType,
          strategy,
          matchStrategy,
          integrationConfig,
        },
        this.getWorkspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Rule not found' });
      }
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  deleteRule: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    try {
      await this.datastoreRepository.deleteRelationshipRule(
        id,
        this.getWorkspaceId(req),
      );
      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  applyRule: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    try {
      const result = await this.datastoreRepository.applyRelationshipRule(id, {
        workspaceId: this.getWorkspaceId(req),
      });
      return res.status(200).json(result);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('not found')) {
        return res.status(404).json({ error: e.message });
      }
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };

  dryRunRule: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    const { sampleLimit } = req.query;
    const parsedSampleLimit = sampleLimit
      ? parseInt(sampleLimit as string, 10)
      : undefined;
    if (
      parsedSampleLimit !== undefined &&
      (!Number.isFinite(parsedSampleLimit) || parsedSampleLimit <= 0)
    ) {
      return res
        .status(400)
        .json({ error: 'sampleLimit must be a positive integer' });
    }

    try {
      const result = await this.datastoreRepository.applyRelationshipRule(id, {
        workspaceId: this.getWorkspaceId(req),
        dryRun: true,
        sampleLimit: parsedSampleLimit,
      });
      return res.status(200).json(result);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('not found')) {
        return res.status(404).json({ error: e.message });
      }
      return res.status(500).json({ error: serializeCaughtError(e) });
    }
  };

  previewRule: RequestHandler = async (req, res) => {
    const {
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression,
      targetFieldExpression,
      relationshipType,
      reciprocalRelationshipType,
      matchStrategy,
      strategy,
      integrationConfig,
      sourceFilterExpression,
      targetFilterExpression,
    } = req.body;
    const { limit, offset, sampleLimit, sourceObjectId } = req.query;

    if (
      !sourceDatasourceId ||
      !targetDatasourceId ||
      !sourceFieldExpression ||
      !relationshipType
    ) {
      return res.status(400).json({
        error:
          'sourceDatasourceId, targetDatasourceId, sourceFieldExpression, and relationshipType are required',
      });
    }

    if (!isUuid(sourceDatasourceId) || !isUuid(targetDatasourceId)) {
      return res.status(400).json({ error: 'Invalid datasource ID format' });
    }

    if (strategy !== undefined && !isRelationshipRuleStrategy(strategy)) {
      return res.status(400).json({
        error: `Invalid strategy: ${String(strategy)}. Expected one of ${RELATIONSHIP_RULE_STRATEGIES.join(', ')}`,
      });
    }

    if (strategy === 'field-matching' && integrationConfig) {
      return res.status(400).json({
        error: 'field-matching preview cannot include integrationConfig',
      });
    }

    const resolvedStrategy =
      strategy ?? (integrationConfig ? 'integration-backed' : undefined);

    if (resolvedStrategy === 'integration-backed' && !integrationConfig) {
      return res.status(400).json({
        error: 'integration-backed preview requires integrationConfig',
      });
    }

    if (resolvedStrategy === 'integration-backed' && !targetFieldExpression) {
      return res.status(400).json({
        error: 'integration-backed preview requires targetFieldExpression',
      });
    }

    if (
      sourceObjectId !== undefined &&
      (typeof sourceObjectId !== 'string' ||
        sourceObjectId.length === 0 ||
        sourceObjectId.length > 1024)
    ) {
      return res.status(400).json({
        error:
          'sourceObjectId must be a non-empty string of at most 1024 characters',
      });
    }

    const MAX_SAMPLE_LIMIT = 50;
    const parsedSampleLimit = sampleLimit
      ? parseInt(sampleLimit as string, 10)
      : undefined;
    if (
      parsedSampleLimit !== undefined &&
      (!Number.isFinite(parsedSampleLimit) ||
        parsedSampleLimit <= 0 ||
        parsedSampleLimit > MAX_SAMPLE_LIMIT)
    ) {
      return res.status(400).json({
        error: `sampleLimit must be an integer between 1 and ${MAX_SAMPLE_LIMIT}`,
      });
    }

    let resolvedMatchStrategy: RelationshipRuleMatchStrategy = 'exact';
    if (matchStrategy) {
      if (!isMatchStrategy(matchStrategy)) {
        return res.status(400).json({
          error: `Invalid matchStrategy: ${String(matchStrategy)}. Expected one of ${MATCH_STRATEGIES.join(', ')}`,
        });
      }
      resolvedMatchStrategy = matchStrategy;
    }

    try {
      const result = await this.datastoreRepository.previewRelationshipRule({
        workspaceId: this.getWorkspaceId(req),
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression,
        targetFieldExpression: targetFieldExpression || undefined,
        relationshipType,
        reciprocalRelationshipType: reciprocalRelationshipType ?? undefined,
        matchStrategy: resolvedMatchStrategy,
        strategy: resolvedStrategy,
        integrationConfig: integrationConfig ?? undefined,
        sourceFilterExpression: sourceFilterExpression ?? undefined,
        targetFilterExpression: targetFilterExpression ?? undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        sampleLimit: parsedSampleLimit,
        sourceObjectId,
      });
      return res.status(200).json(result);
    } catch (e: unknown) {
      const message = serializeCaughtError(e);
      this.logger?.error(`Relationship rule preview failed: ${message}`);
      return res.status(500).json({ error: message });
    }
  };

  inferExamplePattern: RequestHandler = async (req, res) => {
    const {
      sourceDatasourceId,
      sourceObjectId,
      targetDatasourceId,
      targetObjectId,
    } = req.body;

    if (
      !sourceDatasourceId ||
      !sourceObjectId ||
      !targetDatasourceId ||
      !targetObjectId
    ) {
      return res.status(400).json({
        error:
          'sourceDatasourceId, sourceObjectId, targetDatasourceId, and targetObjectId are required',
      });
    }

    if (!isUuid(sourceDatasourceId) || !isUuid(targetDatasourceId)) {
      return res.status(400).json({ error: 'Invalid datasource ID format' });
    }

    if (!this.objectDao) {
      return res.status(500).json({ error: 'Object DAO is not configured' });
    }

    try {
      const [source, target] = await Promise.all([
        this.objectDao.getDatastoreItem(
          sourceDatasourceId,
          sourceObjectId,
          this.getWorkspaceId(req),
        ),
        this.objectDao.getDatastoreItem(
          targetDatasourceId,
          targetObjectId,
          this.getWorkspaceId(req),
        ),
      ]);

      if (!source) {
        return res.status(404).json({ error: 'Source object not found' });
      }
      if (!target) {
        return res.status(404).json({ error: 'Target object not found' });
      }

      return res.status(200).json({
        candidates: inferExampleRelationshipPattern({
          sourceObject: source.object,
          targetObject: target.object,
        }),
      });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  approveRule: RequestHandler = async (req, res) => {
    return this.transitionState(req, res, 'suggested', 'active', 'approve');
  };

  bulkApproveRules: RequestHandler = async (req, res) => {
    const { ids } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (!ids.every(id => typeof id === 'string' && isUuid(id))) {
      return res.status(400).json({ error: 'ids must all be rule UUIDs' });
    }

    // The same id twice would otherwise be approved on its first pass and then
    // reported as "already active" on its second.
    const uniqueIds = [...new Set<string>(ids)];

    try {
      // Snapshot the suggested set BEFORE approving anything: listRelationshipRules
      // filters state in SQL, so a rule already flipped to active would vanish from
      // this lookup and its inverse pairing could never be computed.
      const { items } = await this.relationshipRuleDao.listRelationshipRules({
        workspaceId: this.getWorkspaceId(req),
        state: 'suggested',
        limit: RULE_STATE_SCAN_PAGE,
      });
      const { approveIds, dismissInverseIds } = splitSuggestedRuleBulkApprove(
        items,
        uniqueIds,
      );
      const inverseByRuleId = buildInverseMap(items);
      const toDismiss = new Set(dismissInverseIds);

      // One active snapshot for the whole batch: querying per id turned an
      // N-rule approve into N full scans of the active set. Each rule approved
      // below is pushed onto it, so a later id whose mirror was approved earlier
      // in this same batch is still refused — a static snapshot would let both
      // directions through.
      const { items: activeRules } =
        await this.relationshipRuleDao.listRelationshipRules({
          workspaceId: this.getWorkspaceId(req),
          state: 'active',
          limit: RULE_STATE_SCAN_PAGE,
        });

      const requested = new Set(uniqueIds);
      const approved: string[] = [];
      const dismissedAsInverse: string[] = [];
      // `failed` answers the caller's request, so it carries requested ids only
      // — a mirror the caller never named must not inflate their failure count.
      // Anything that went wrong for such a mirror goes to `inverseDismissFailed`.
      const failed: Array<{ id: string; reason: string }> = [];
      const inverseDismissFailed: Array<{ id: string; reason: string }> = [];
      const reportFailure = (id: string, reason: string) => {
        (requested.has(id) ? failed : inverseDismissFailed).push({
          id,
          reason,
        });
      };

      // Resolved once for the whole batch: the actor is the same for every
      // verdict recorded below, and re-deriving it per id would re-run auth.
      const actor = await this.resolveActor(req);

      for (const id of approveIds) {
        // Each id gets its own try: applying a rule does real work and can
        // throw, and one bad rule must not discard the batch's other results.
        try {
          const rule = await this.relationshipRuleDao.getRelationshipRule(
            id,
            this.getWorkspaceId(req),
          );
          if (!rule) {
            failed.push({ id, reason: 'Rule not found' });
            continue;
          }
          if (rule.state !== 'suggested') {
            failed.push({
              id,
              reason: `Rule is currently '${rule.state}', expected 'suggested'`,
            });
            continue;
          }
          const activeInverse = findInverseAmong(rule, activeRules);
          if (activeInverse) {
            failed.push({
              id,
              reason: `An equivalent active rule already exists (${activeInverse.id})`,
            });
            continue;
          }
          // Serialize the flip against EVERY suggested mirror, same as the
          // single-approve path. The unlocked active guard above is the fast
          // path for a pre-existing active mirror; this pair lock closes the
          // concurrent case (a separate request approving the opposite
          // direction at the same time) that two independent CASes can't. All
          // suggested inverses go into the lock set — a single one would let two
          // approves of duplicate mirror rows lock disjoint pairs and both win.
          // Dismissal below still targets the single paired mirror the split
          // chose (`toDismiss`); the lock set is the broader concurrency guard.
          const suggestedMirror = inverseByRuleId.get(id);
          const suggestedMirrorIds = findInverses(rule, items).map(r => r.id);
          const result =
            await this.relationshipRuleDao.transitionStateWithPairLock({
              workspaceId: this.getWorkspaceId(req),
              id,
              toState: 'active',
              expectedState: 'suggested',
              reviewReason: null,
              blockingMirrorIds: suggestedMirrorIds,
            });
          if (result.status === 'conflict') {
            failed.push({
              id,
              reason:
                result.reason === 'mirror-active'
                  ? `An equivalent active rule already exists (${suggestedMirrorIds.join(', ')})`
                  : 'Rule was concurrently modified out of state suggested',
            });
            continue;
          }
          try {
            await this.datastoreRepository.applyRelationshipRule(id, {
              workspaceId: this.getWorkspaceId(req),
              triggerSource: 'manual',
            });
          } catch (applyError) {
            // The flip to `active` had to precede apply (applyRelationshipRule
            // refuses a non-active rule), so a thrown apply would otherwise
            // strand the rule `active` with zero edges: a retry could only
            // 409, and its mirror — still `suggested` — would hit the active
            // guard forever, wedging the pair. Roll the rule back to
            // `suggested` so both directions are cleanly retryable, then let
            // the outer catch report the failure.
            //
            // A state reset alone is sufficient: applyRelationshipRuleSealed is
            // atomic on failure (its three-phase swap leaves datastore_relation
            // untouched on any pre-swap throw — see relationshipApply.crashSafety
            // .test.ts), and a suggested rule has no materialized edges anyway.
            await this.relationshipRuleDao.updateRelationshipRuleState(
              id,
              'suggested',
              {
                workspaceId: this.getWorkspaceId(req),
                reviewReason: null,
              },
            );
            throw applyError;
          }
          approved.push(id);
          activeRules.push({ ...rule, state: 'active' });

          // Record the approve verdict so bulk approvals feed Stage 7
          // calibration exactly like the singular path does. Best-effort:
          // verdicts are telemetry and must never fail the batch. rankShown is
          // null on the bulk path — it is an id-based action, not a
          // confidence-filtered as-shown list (SuggestionVerdictDao's
          // "null for bulk actions" case).
          if (isGeneratorOwnedRule(rule)) {
            try {
              await this.suggestionVerdictDao.appendVerdict(
                {
                  ruleId: rule.id,
                  action: 'approve',
                  actor,
                  score: rule.score ?? null,
                  confidenceBand: rule.confidenceBand ?? null,
                  evidenceSummary: rule.evidenceSummary ?? null,
                  rankShown: null,
                },
                this.getWorkspaceId(req),
              );
            } catch {
              // swallow — see comment above
            }
          }

          // Dismiss this rule's mirror here rather than in a trailing loop, so
          // a later id's failure can never strand an approved rule with a live
          // mirror that a subsequent "approve all" would materialize twice.
          //
          // Its own try: the rule above is approved and applied by this point,
          // so a dismissal failure belongs to the mirror, not to the winner. It
          // is reported under the mirror's id — that is the rule still live, and
          // naming it tells the operator which one to dismiss by hand.
          const mirror = suggestedMirror;
          if (mirror && toDismiss.delete(mirror.id)) {
            try {
              await this.dismissAsInverse(mirror.id, this.getWorkspaceId(req));
              dismissedAsInverse.push(mirror.id);
            } catch (e: unknown) {
              reportFailure(
                mirror.id,
                `Could not dismiss as the inverse of approved rule ${id}: ${
                  e instanceof Error ? e.message : String(e)
                }`,
              );
            }
          }
        } catch (e: unknown) {
          failed.push({
            id,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Whatever is left here is a mirror whose winner never got approved, so
      // the reason to suppress it never materialized: dismissing it now would
      // permanently destroy a suggestion in exchange for nothing. Leave it
      // `suggested`. A mirror the caller named still has to be reported, or an
      // id they asked about would come back in no array at all; one they never
      // named is simply untouched and needs no mention.
      for (const id of toDismiss) {
        if (!requested.has(id)) continue;
        const winner = inverseByRuleId.get(id);
        failed.push({
          id,
          reason: `Left suggested: its opposite direction${
            winner ? ` (${winner.id})` : ''
          } was not approved`,
        });
      }

      return res
        .status(200)
        .json({ approved, dismissedAsInverse, failed, inverseDismissFailed });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  dismissRule: RequestHandler = async (req, res) => {
    return this.transitionState(req, res, 'suggested', 'inactive', 'dismiss');
  };

  disableRule: RequestHandler = async (req, res) => {
    return this.transitionState(req, res, 'active', 'inactive');
  };

  resetRule: RequestHandler = async (req, res) => {
    return this.transitionState(req, res, 'inactive', 'suggested', 'reset');
  };

  /**
   * The mirror of `rule` among the rules currently in `state`, or undefined.
   *
   * Queries per call, which is what the single-rule approve path wants. The bulk
   * path scans one pre-fetched set instead — see `findInverseAmong`.
   */
  private async findInverseInState(
    rule: RelationshipRule,
    state: RelationshipRuleState,
    workspaceId: string,
  ): Promise<RelationshipRule | undefined> {
    const { items } = await this.relationshipRuleDao.listRelationshipRules({
      workspaceId,
      state,
      limit: RULE_STATE_SCAN_PAGE,
    });
    return findInverseAmong(rule, items);
  }

  /**
   * The mirror of `rule` in ANY state, read in a single snapshot. The approve
   * guard needs both the `active` mirror (a pre-existing duplicate → 409) and
   * the `suggested` mirror (the concurrent-approve candidate to lock against),
   * and it must not read them as two separate queries: a mirror that flips
   * `active` between an `active` read and a later `suggested` read would be in
   * neither set, so the flip would lock only itself and both directions could
   * go active. Scoping to the pair's datasources returns every candidate the
   * content-keyed pairing could match, in one consistent read.
   */
  private async findInversesAnyState(
    rule: RelationshipRule,
    workspaceId: string,
  ): Promise<RelationshipRule[]> {
    const rules =
      await this.relationshipRuleDao.listRelationshipRulesByDatasourceIds(
        [rule.sourceDatasourceId, rule.targetDatasourceId],
        { workspaceId },
      );
    // EVERY inverse of the pair, not just one: a content key can have several
    // rows (e.g. an inactive-then-reset duplicate alongside a live mirror), and
    // buildInverseMap would keep only the last. The caller needs all of them —
    // an active one must 409, and ALL suggested ones must go into the lock set,
    // or two approves can pick disjoint (self, mirror) pairs and both win.
    // Sorted by id for deterministic error messages / lock ordering.
    return findInverses(rule, rules).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }

  /**
   * Dismiss the mirrored suggestion of a rule being approved. Both sides
   * materialize the same edge, so leaving the mirror suggested means the next
   * approve creates a duplicate. Marked `inverse-suppressed` rather than
   * `manual-dismiss` so insights can tell system suppression from a human "no".
   *
   * The edge delete is a cheap guard, not a necessity: only a `suggested` rule
   * is ever suppressed and those have no materialized edges. It is kept so both
   * approve paths clean up identically and a rule that somehow did get applied
   * can't leave orphan edges behind.
   */
  private async dismissAsInverse(
    ruleId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.relationshipRuleDao.updateRelationshipRuleState(
      ruleId,
      'inactive',
      { workspaceId, reviewReason: 'inverse-suppressed' },
    );
    await this.relationshipDao.deleteByRuleId(ruleId, undefined, workspaceId);
  }

  private async suppressInverseSuggestion(
    approved: RelationshipRule,
    workspaceId: string,
  ): Promise<void> {
    const inverse = await this.findInverseInState(
      approved,
      'suggested',
      workspaceId,
    );
    if (inverse) {
      await this.dismissAsInverse(inverse.id, workspaceId);
    }
  }

  private async transitionState(
    req: express.Request,
    res: express.Response,
    fromState: RelationshipRuleState,
    toState: RelationshipRuleState,
    verdictAction?: SuggestionVerdictAction,
  ) {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    try {
      const rule = await this.relationshipRuleDao.getRelationshipRule(
        id,
        this.getWorkspaceId(req),
      );
      if (!rule) {
        return res.status(404).json({ error: 'Rule not found' });
      }
      if (rule.state !== fromState) {
        return res.status(409).json({
          error: `Rule is currently '${rule.state}', expected '${fromState}'`,
        });
      }
      const outcome = await this.runTransition({
        rule,
        toState,
        verdictAction,
        req,
      });
      if (!outcome.ok) {
        return res.status(outcome.status).json({ error: outcome.error });
      }
      return res.status(200).json(outcome.rule);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * One hop of the state machine, for a rule already read and confirmed to be in
   * the hop's source state. Returns its result instead of writing a response, so
   * `setRuleState` can chain the two-hop moves and still report where a partial
   * walk stopped. Throws on unexpected failure — callers own the 500.
   */
  private async runTransition(opts: {
    rule: RelationshipRule;
    toState: RelationshipRuleState;
    verdictAction?: SuggestionVerdictAction;
    req: express.Request;
  }): Promise<TransitionOutcome> {
    const { rule, toState, verdictAction, req } = opts;
    const id = rule.id;
    const fromState = rule.state;
    const workspaceId = this.getWorkspaceId(req);
    let updated: RelationshipRule;
    if (toState === 'active') {
      // Discover every mirror in a single snapshot across all states (see
      // findInversesAnyState — two per-state reads leave a crack a mirror can
      // slip through). A pre-existing active mirror is a duplicate edge and is
      // refused outright; the suggested mirrors are the concurrent-approve
      // candidates we serialize the flip against.
      const mirrors = await this.findInversesAnyState(rule, workspaceId);
      const activeMirror = mirrors.find(m => m.state === 'active');
      if (activeMirror) {
        // Refuse rather than duplicate the edge or silently disable the other
        // rule: an active mirror is invisible to the suggested-set
        // suppression, so approving on top of it would materialize the same
        // edge twice.
        return {
          ok: false,
          status: 409,
          error: `An equivalent active rule already exists (${activeMirror.id})`,
        };
      }
      // Serialize the flip against ALL suggested mirrors: two callers
      // approving opposite directions both find each other here and both
      // proceed to the lock; the lock lets exactly one win — the loser wakes
      // to a now-active mirror and 409s. All of them go into the lock set
      // because duplicate suggested rows for one direction would otherwise let
      // two approves lock disjoint pairs and both go active.
      const blockingMirrorIds = mirrors
        .filter(m => m.state === 'suggested')
        .map(m => m.id);
      const result = await this.relationshipRuleDao.transitionStateWithPairLock(
        {
          workspaceId,
          id,
          toState: 'active',
          expectedState: fromState,
          reviewReason: null,
          blockingMirrorIds,
        },
      );
      if (result.status === 'conflict') {
        return {
          ok: false,
          status: 409,
          error:
            result.reason === 'mirror-active'
              ? `An equivalent active rule already exists (${blockingMirrorIds.join(', ')})`
              : `Rule is no longer in expected state '${fromState}'`,
        };
      }
      updated = result.rule;
    } else {
      const flipped =
        await this.relationshipRuleDao.updateRelationshipRuleState(
          id,
          toState,
          {
            workspaceId,
            reviewReason:
              fromState === 'suggested' && toState === 'inactive'
                ? 'manual-dismiss'
                : null,
            // Compare-and-swap on the read-checked state: if a concurrent
            // transition moved the row out of `fromState` since the read
            // above, this matches zero rows and returns undefined.
            expectedState: fromState,
          },
        );
      if (!flipped) {
        // Lost the race — the row is no longer in `fromState`. Same 409 as the
        // stale-read guard above, now honest under concurrency rather than a
        // silent success that returns a null body.
        return {
          ok: false,
          status: 409,
          error: `Rule is no longer in expected state '${fromState}'`,
        };
      }
      updated = flipped;
    }
    if (toState === 'inactive') {
      // Through the repository, not the DAO: removing the rule's edges must
      // re-materialize the context groups that merged on them.
      await this.datastoreRepository.deleteRelationshipsByRuleId(
        id,
        workspaceId,
      );
    }
    if (toState === 'active') {
      // Apply first, suppress after — the same order the bulk path uses. The
      // reverse left a 500 here materializing nothing: the rule was already
      // `active`, so the retry could only 409, and only a manual apply
      // recovered it.
      try {
        await this.datastoreRepository.applyRelationshipRule(id, {
          workspaceId,
          triggerSource: 'manual',
        });
      } catch (applyError) {
        // Mirror the bulk path's rollback: the flip to `active` is forced to
        // precede apply, so a thrown apply strands the rule `active` with no
        // edges and permanently wedges its still-`suggested` mirror behind
        // the active guard. Reset to `fromState` so both are retryable, then
        // rethrow to the 500 catch. A state reset alone suffices — the sealed
        // apply is atomic on failure (relationshipApply.crashSafety.test.ts)
        // and a suggested rule has no edges to clear.
        await this.relationshipRuleDao.updateRelationshipRuleState(
          id,
          fromState,
          { workspaceId, reviewReason: null },
        );
        throw applyError;
      }
      // Best effort, like the bulk path: the approve is done and cannot be
      // retried, so reporting it as failed would be a lie. A mirror left
      // suggested is recoverable by dismissing it by hand.
      try {
        await this.suppressInverseSuggestion(rule, workspaceId);
      } catch (e: unknown) {
        this.logger?.warn(
          `Approved rule ${id} but could not suppress its mirrored suggestion: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    if (verdictAction && isGeneratorOwnedRule(rule)) {
      // Verdicts are telemetry for calibration — never fail the transition.
      try {
        const rankShownRaw: unknown = req.body?.rankShown;
        await this.suggestionVerdictDao.appendVerdict(
          {
            ruleId: rule.id,
            action: verdictAction,
            actor: await this.resolveActor(req),
            score: rule.score ?? null,
            confidenceBand: rule.confidenceBand ?? null,
            evidenceSummary: rule.evidenceSummary ?? null,
            rankShown:
              typeof rankShownRaw === 'number' &&
              Number.isInteger(rankShownRaw) &&
              rankShownRaw >= 0
                ? rankShownRaw
                : null,
          },
          workspaceId,
        );
      } catch {
        // swallow — see comment above
      }
    }

    return { ok: true, rule: updated };
  }

  /**
   * Set a rule's state directly, walking whatever transitions the move needs.
   *
   * The four verb routes are one-way and 409 from the wrong state, which forces
   * every caller that knows only its *desired* state to reimplement the machine
   * (the bundle importer's `driveRuleState` is one such copy). This route is the
   * declarative form: idempotent, so re-sending the current state is a no-op
   * 200, which is what a config-management client needs in order to converge
   * without first reading the state and branching on it.
   */
  setRuleState: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    const desired: unknown = req.body?.state;
    if (!isRelationshipRuleState(desired)) {
      return res.status(400).json({
        error: `Invalid state: ${String(
          desired,
        )}. Expected 'suggested', 'active' or 'inactive'.`,
      });
    }

    try {
      let rule = await this.relationshipRuleDao.getRelationshipRule(
        id,
        this.getWorkspaceId(req),
      );
      if (!rule) {
        return res.status(404).json({ error: 'Rule not found' });
      }

      // Empty path when already there — the no-op that makes this idempotent.
      for (const transition of relationshipRuleStatePath(rule.state, desired)) {
        const outcome = await this.runTransition({
          rule,
          toState: STATE_AFTER_TRANSITION[`${transition}`],
          verdictAction: VERDICT_FOR_TRANSITION[`${transition}`],
          req,
        });
        if (!outcome.ok) {
          // Report the state the rule actually reached, not the one it started
          // in: a two-hop move that fails on the second hop has already moved.
          return res
            .status(outcome.status)
            .json({ error: outcome.error, state: rule.state });
        }
        rule = outcome.rule;
      }

      return res.status(200).json(rule);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  private async resolveActor(req: express.Request): Promise<string> {
    return callerAttribution(this.httpAuth, req);
  }

  listRelationshipsByRule: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { limit, offset } = req.query;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    try {
      const result = await this.relationshipDao.listRelationshipsByRuleId(id, {
        workspaceId: this.getWorkspaceId(req),
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });
      return res.status(200).json(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}
