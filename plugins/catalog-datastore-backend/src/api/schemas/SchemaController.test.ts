import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { CatalogWorkflowClient } from '@roadiehq/catalog-workflow-common';
import type { LoggerService } from '@roadiehq/extensions-api';
import type { RelationshipSuggestionEvidenceSummary } from '@roadiehq/catalog-datastore-common';
import { SchemaController, SUPPRESSED_RESPONSE_CAP } from './SchemaController';
import {
  ObjectDao,
  RelationshipRuleDao,
  SchemaDao,
  SuggestionVerdictDao,
} from '../../database';
import type { SuggestionVerdict } from '../../database/SuggestionVerdictDao';
import {
  allowAllScopeService,
  SCOPES,
  type ScopeService,
} from '@roadiehq/scopes';
import * as suggestRelationshipsService from './suggestRelationshipsService';

const scopeService = allowAllScopeService;

/** Tags each guard with the scopes it demands, then passes every request
 *  through — `allowAllScopeService` grants everything, so it can't tell an
 *  under-scoped route from a correctly-scoped one. */
function createRecordingScopeService(): ScopeService {
  return {
    getGrantedScopes: () => [],
    requireScopes: (...required: string[]) => {
      const guard: any = (_req: unknown, _res: unknown, next: () => void) =>
        next();
      guard.requiredScopes = required;
      return guard;
    },
    requireScopeFamily: () => (_req, _res, next) => next(),
  };
}

/** Route path → the scopes its guard demands, read back off the built router
 *  so the assertion names the routes it cares about instead of depending on
 *  the registration order of every route in the router. */
function scopesByRoutePath(router: unknown): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const layer of (router as any).stack ?? []) {
    if (!layer.route) continue;
    for (const routeLayer of layer.route.stack ?? []) {
      const scopes = routeLayer.handle?.requiredScopes;
      if (scopes) byPath.set(layer.route.path, scopes);
    }
  }
  return byPath;
}

// Wraps the real implementation so tests can assert on the args
// SchemaController passed it (the datasourceNamesById map, in particular)
// without losing end-to-end coverage through the actual scoring pipeline.
vi.mock('./suggestRelationshipsService', async importOriginal => {
  const actual =
    await importOriginal<typeof import('./suggestRelationshipsService')>();
  return {
    ...actual,
    buildSuggestions: vi.fn(actual.buildSuggestions),
  };
});

/**
 * Sampled objects that mirror the "id↔id" fixture in
 * suggestRelationshipsService.test.ts: an identical `id` field on both sides
 * is an unconditional gate short-circuit (identity-mirror), so it's a
 * deterministic way to get a real, gate-suppressed candidate through the
 * actual pipeline rather than a hand-built FieldMatch.
 */
function mockIdMirrorSample(objectDao: {
  sampleForSuggestions: ReturnType<typeof vi.fn>;
}) {
  const ids = ['aaa-bbb', 'ccc-ddd', 'eee-fff'];
  objectDao.sampleForSuggestions.mockImplementation(
    async (datasourceId: string) => ({
      total: ids.length,
      items: ids.map((id, index) => ({
        id: `${datasourceId}-${index}`,
        datasourceId,
        objectId: `${datasourceId}-${index}`,
        object: { id },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    }),
  );
}

/**
 * `fieldCount` field pairs, each with only 2 distinct eligible values — below
 * the trivial-domain gate's minimum distinct count, so every pair is
 * suppressed. Distinct value strings per index keep dedupeSourceFields from
 * collapsing the pairs into fewer suggestions, so this reliably yields
 * `fieldCount` suppressed candidates for a single-datasource cap test.
 */
function mockManyTrivialDomainPairs(
  objectDao: { sampleForSuggestions: ReturnType<typeof vi.fn> },
  sourceDatasourceId: string,
  targetDatasourceId: string,
  fieldCount: number,
) {
  const buildObjects = (fieldPrefix: string) =>
    ['a', 'b'].map(suffix => {
      const object: Record<string, string> = {};
      for (let i = 0; i < fieldCount; i++) {
        object[`${fieldPrefix}${i}`] = `val${i}${suffix}`;
      }
      return object;
    });
  const objectsByDatasource: Record<string, Record<string, string>[]> = {
    [sourceDatasourceId]: buildObjects('f'),
    [targetDatasourceId]: buildObjects('g'),
  };
  objectDao.sampleForSuggestions.mockImplementation(
    async (datasourceId: string) => {
      const objects = objectsByDatasource[`${datasourceId}`] ?? [];
      return {
        total: objects.length,
        items: objects.map((object, index) => ({
          id: `${datasourceId}-${index}`,
          datasourceId,
          objectId: `${datasourceId}-${index}`,
          object,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      };
    },
  );
}

// Mirrors scoreCalibration.test.ts's fixture: a single 'prior' waterfall
// entry whose weight is the whole rawLogOdds is enough for
// computeCalibration to reconstruct a label's log-odds feature.
const CALIBRATION_FIELD_STATS = {
  distinctCount: 0,
  rowCoverage: 0,
  cardinalityRatio: 0,
  looksEnumLike: false,
  isIdentifierLike: false,
};

function evidenceWithLogOdds(
  rawLogOdds: number,
): RelationshipSuggestionEvidenceSummary {
  return {
    valueTypes: [],
    distinctMatchedValueCount: 0,
    sourceFieldStats: CALIBRATION_FIELD_STATS,
    targetFieldStats: CALIBRATION_FIELD_STATS,
    commonValuePenalty: 0,
    topMatchedValues: [],
    explanation: '',
    waterfall: [{ signal: 'prior', fired: true, weight: rawLogOdds }],
  };
}

let nextCalibrationVerdictId = 0;
function calibrationVerdict(
  ruleId: string,
  action: SuggestionVerdict['action'],
  rawLogOdds: number,
): SuggestionVerdict {
  nextCalibrationVerdictId += 1;
  return {
    id: `calibration-verdict-${nextCalibrationVerdictId}`,
    ruleId,
    action,
    actor: 'user:default/test',
    score: null,
    confidenceBand: null,
    evidenceSummary: evidenceWithLogOdds(rawLogOdds),
    rankShown: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * 15 approves at +4 and 15 dismisses at -4 — both classes, well past
 * MIN_CALIBRATION_LABELS (30), so computeCalibration returns a fitted
 * (non-identity) calibration.
 */
function buildCalibratingVerdicts(): SuggestionVerdict[] {
  const verdicts: SuggestionVerdict[] = [];
  for (let i = 0; i < 15; i += 1) {
    verdicts.push(calibrationVerdict(`approve-rule-${i}`, 'approve', 4));
    verdicts.push(calibrationVerdict(`dismiss-rule-${i}`, 'dismiss', -4));
  }
  return verdicts;
}

describe('SchemaController', () => {
  const sourceDatasourceId = '550e8400-e29b-41d4-a716-446655440000';
  const targetDatasourceId = '660e8400-e29b-41d4-a716-446655440000';

  function createControllerDeps() {
    const objectDao = {
      randomSample: vi.fn(),
      sampleForSuggestions: vi.fn(),
    };
    const relationshipRuleDao = {
      findExistingRule: vi.fn(),
      createRelationshipRule: vi.fn(),
      listRelationshipRulesByDatasourceId: vi.fn().mockResolvedValue([]),
      updateRelationshipRuleState: vi.fn(),
    };
    const schemaDao = {
      listDatasourceSchemas: vi.fn(),
      getLatestSchema: vi.fn(),
      listSchemaVersions: vi.fn(),
    };
    const catalogWorkflowClient = {
      list: vi.fn(),
    };
    const suggestionVerdictDao = {
      listVerdictsForCalibration: vi.fn().mockResolvedValue([]),
    };
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    return {
      objectDao,
      relationshipRuleDao,
      schemaDao,
      catalogWorkflowClient,
      suggestionVerdictDao,
      logger,
    };
  }

  it('returns suggestions when the suggest-relationships flow succeeds', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
    });
    deps.objectDao.sampleForSuggestions.mockResolvedValue({
      total: 1,
      items: [
        {
          id: uuid(),
          datasourceId: sourceDatasourceId,
          objectId: 'source-1',
          object: { metadata: { name: 'alpha' } },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    deps.relationshipRuleDao.findExistingRule.mockResolvedValue(undefined);
    deps.relationshipRuleDao.createRelationshipRule.mockResolvedValue({
      id: uuid(),
      name: '$.metadata.name → $.metadata.name',
      description: null,
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression: '$.metadata.name',
      targetFieldExpression: '$.metadata.name',
      sourceFilterExpression: null,
      targetFilterExpression: null,
      relationshipType: 'relatedTo',
      reciprocalRelationshipType: 'relatesTo',
      matchStrategy: 'exact',
      origin: 'generated',
      state: 'suggested',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    expect(response.status).toBe(200);
    expect(deps.catalogWorkflowClient.list).toHaveBeenCalledWith({
      enabled: true,
      limit: 200,
      offset: 0,
    });
  });

  it('pages past the workflow list page size when resolving enabled datasources', async () => {
    const deps = createControllerDeps();
    const workspaceId = '22222222-2222-4222-8222-222222222222';
    // The datasource under test sits on the SECOND page — with unpaginated
    // listing it would be treated as disabled and the request would 409.
    const firstPage = Array.from({ length: 200 }, (_, i) => ({
      id: `550e8400-e29b-41d4-a716-4466554${String(i).padStart(5, '0')}`,
      nodes: [],
    }));
    deps.catalogWorkflowClient.list
      .mockResolvedValueOnce({ data: firstPage, total: 201 })
      .mockResolvedValueOnce({
        data: [{ id: sourceDatasourceId, nodes: [] }],
        total: 201,
      });
    deps.objectDao.sampleForSuggestions.mockResolvedValue({
      total: 0,
      items: [],
    });

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
      getWorkspaceId: () => workspaceId,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    expect(response.status).toBe(200);
    expect(deps.catalogWorkflowClient.list).toHaveBeenCalledWith({
      enabled: true,
      limit: 200,
      offset: 0,
      workspaceId,
    });
    expect(deps.catalogWorkflowClient.list).toHaveBeenCalledWith({
      enabled: true,
      limit: 200,
      offset: 200,
      workspaceId,
    });
  });

  it('scopes batch staling to the datasources the run evaluated', async () => {
    const outOfScopeDatasourceId = '770e8400-e29b-41d4-a716-446655440000';
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [
        { id: sourceDatasourceId },
        { id: targetDatasourceId },
        { id: outOfScopeDatasourceId },
      ],
      total: 3,
    });
    deps.objectDao.sampleForSuggestions.mockResolvedValue({
      total: 0,
      items: [],
    });
    // Two prior unreviewed suggestions from the source datasource: one
    // targeting a datasource in this run's scope, one targeting an enabled
    // datasource outside it.
    deps.relationshipRuleDao.listRelationshipRulesByDatasourceId.mockImplementation(
      async (datasourceId: string) =>
        datasourceId === sourceDatasourceId
          ? [
              {
                id: 'in-scope-rule',
                sourceDatasourceId,
                targetDatasourceId,
                sourceFieldExpression: '$.a',
                targetFieldExpression: '$.b',
                state: 'suggested',
                origin: 'generated',
                strategy: 'field-matching',
              },
              {
                id: 'out-of-scope-rule',
                sourceDatasourceId,
                targetDatasourceId: outOfScopeDatasourceId,
                sourceFieldExpression: '$.a',
                targetFieldExpression: '$.c',
                state: 'suggested',
                origin: 'generated',
                strategy: 'field-matching',
              },
            ]
          : [],
    );

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use(express.json());
    app.use('/schemas', await controller.getRouter());

    const response = await request(app)
      .post('/schemas/suggest-relationships')
      .send({ datasourceIds: [sourceDatasourceId, targetDatasourceId] });

    expect(response.status).toBe(200);
    // The in-scope pair was re-evaluated and came up empty → staled. The
    // out-of-scope rule was never evaluated → untouched.
    expect(
      deps.relationshipRuleDao.updateRelationshipRuleState,
    ).toHaveBeenCalledWith('in-scope-rule', 'inactive', {
      reviewReason: 'auto-staled',
    });
    expect(
      deps.relationshipRuleDao.updateRelationshipRuleState,
    ).not.toHaveBeenCalledWith('out-of-scope-rule', expect.anything(), {
      reviewReason: 'auto-staled',
    });
  });

  it('treats a batch of one datasource repeated as a single-datasource batch', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }],
      total: 1,
    });

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use(express.json());
    app.use('/schemas', await controller.getRouter());

    // [X, X] must not sneak past the pair guard: each source's target list
    // filters to empty, and the guard short-circuits before ever sampling.
    const response = await request(app)
      .post('/schemas/suggest-relationships')
      .send({ datasourceIds: [sourceDatasourceId, sourceDatasourceId] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      results: [
        { datasourceId: sourceDatasourceId, total: 0, suggestions: [] },
      ],
      pairs: [],
      createdRules: [],
    });
    expect(deps.objectDao.sampleForSuggestions).not.toHaveBeenCalled();
  });

  it('returns empty for a single-datasource batch instead of searching globally', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }],
      total: 1,
    });

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use(express.json());
    app.use('/schemas', await controller.getRouter());

    const response = await request(app)
      .post('/schemas/suggest-relationships')
      .send({ datasourceIds: [sourceDatasourceId] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      results: [
        { datasourceId: sourceDatasourceId, total: 0, suggestions: [] },
      ],
      pairs: [],
      createdRules: [],
    });
    expect(deps.objectDao.sampleForSuggestions).not.toHaveBeenCalled();
  });

  it('groups batch suggestions by datasource pair in the response', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
      total: 2,
    });
    // Matched uuids on a same-named `entityId` field, plus a couple of decoy
    // fields on each side — real-shaped enough to reach the FS scorer's
    // medium/high band (full containment + matching name/type), and to give
    // measureU's random cross-datasource pairs a non-degenerate pool to
    // sample from (a single field per side makes every random pair the real
    // one, which skews measured u away from realistic base rates). The decoy
    // fields deliberately vary in cardinality (a low-cardinality enum plus a
    // high-cardinality uuid) so key-key-penalty's measured u isn't pinned to
    // "always both sides unique".
    const matchedIds = Array.from({ length: 5 }, () => uuid());
    deps.objectDao.sampleForSuggestions.mockImplementation(
      async (datasourceId: string) => ({
        total: 5,
        items: matchedIds.map((value, index) => ({
          id: uuid(),
          datasourceId,
          objectId: `${datasourceId}-${index}`,
          object:
            datasourceId === sourceDatasourceId
              ? {
                  entityId: value,
                  decoyStatus: index % 2 === 0 ? 'active' : 'inactive',
                  decoyNote: uuid(),
                }
              : {
                  entityId: value,
                  decoyState: index % 2 === 0 ? 'open' : 'closed',
                  decoyRef: uuid(),
                },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      }),
    );
    deps.relationshipRuleDao.findExistingRule.mockResolvedValue(undefined);
    deps.relationshipRuleDao.createRelationshipRule.mockImplementation(
      async (input: Record<string, unknown>) => ({ id: uuid(), ...input }),
    );

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use(express.json());
    app.use('/schemas', await controller.getRouter());

    const response = await request(app)
      .post('/schemas/suggest-relationships')
      .send({ datasourceIds: [sourceDatasourceId, targetDatasourceId] });

    expect(response.status).toBe(200);
    expect(response.body.pairs).toHaveLength(1);
    expect(response.body.pairs[0].datasourceIds).toEqual(
      [sourceDatasourceId, targetDatasourceId].sort(),
    );
    expect(response.body.pairs[0].suggestions.length).toBeGreaterThan(0);
    expect(response.body.pairs[0].suggestions[0]).toMatchObject({
      sourceDatasourceId,
      targetDatasourceId,
    });
  });

  it('feeds workflow names into the single-datasource run so name-similarity can match on the referenced container name', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [
        { id: sourceDatasourceId, name: 'source-events' },
        { id: targetDatasourceId, name: 'aws-accounts' },
      ],
      total: 2,
    });
    // `account_id` (source) shares only the generic "id" token with target's
    // own field path ("id") — nameSimilarity alone lands well under the 0.5
    // threshold. It clears it only once "accounts" — from the target
    // datasource's name "aws-accounts", bridging account_id's "account"
    // token via the singular/plural rule — is folded in, which proves the
    // name reached the service rather than merely being accepted as a param.
    const matchedIds = Array.from({ length: 5 }, () => uuid());
    deps.objectDao.sampleForSuggestions.mockImplementation(
      async (datasourceId: string) => ({
        total: 5,
        items: matchedIds.map((value, index) => ({
          id: uuid(),
          datasourceId,
          objectId: `${datasourceId}-${index}`,
          object:
            datasourceId === sourceDatasourceId
              ? {
                  account_id: value,
                  decoyStatus: index % 2 === 0 ? 'active' : 'inactive',
                  decoyNote: uuid(),
                }
              : {
                  id: value,
                  decoyState: index % 2 === 0 ? 'open' : 'closed',
                  decoyRef: uuid(),
                },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      }),
    );
    deps.relationshipRuleDao.findExistingRule.mockResolvedValue(undefined);

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    expect(response.status).toBe(200);
    // The candidate can land as a top-level suggestion or a score-suppressed
    // one depending on the rest of the FS score — either way it went through
    // the real scoring pipeline and kept its waterfall (only gate-suppressed
    // candidates drop theirs), so name-similarity's firing is observable
    // regardless of which bucket the candidate lands in.
    type WireCandidate = {
      sourceField: string;
      targetField: string;
      evidenceSummary: { waterfall?: { signal: string; detail?: string }[] };
    };
    const candidate = [
      ...(response.body.suggestions as WireCandidate[]),
      ...(response.body.suppressedSuggestions as WireCandidate[]),
    ].find(s => s.sourceField === '$.account_id' && s.targetField === '$.id');
    expect(candidate).toBeDefined();
    const nameEntry = candidate?.evidenceSummary.waterfall?.find(
      e => e.signal === 'name-similarity',
    );
    expect(nameEntry).toMatchObject({ fired: true });
    expect(nameEntry?.detail).toBe('name $.account_id↔aws-accounts.$.id');
  });

  it('passes the workflow name map to buildSuggestions for both the single and batch endpoints', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [
        { id: sourceDatasourceId, name: 'source-events' },
        { id: targetDatasourceId, name: 'aws-accounts' },
      ],
      total: 2,
    });
    deps.objectDao.sampleForSuggestions.mockResolvedValue({
      total: 0,
      items: [],
    });

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use(express.json());
    app.use('/schemas', await controller.getRouter());

    const buildSuggestionsSpy = vi.mocked(
      suggestRelationshipsService.buildSuggestions,
    );
    buildSuggestionsSpy.mockClear();

    const expectedNamesById = {
      [sourceDatasourceId]: 'source-events',
      [targetDatasourceId]: 'aws-accounts',
    };

    await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );
    expect(buildSuggestionsSpy).toHaveBeenCalledWith(
      deps.objectDao,
      sourceDatasourceId,
      [targetDatasourceId],
      undefined,
      expectedNamesById,
      { a: 1, b: 0, labelCount: 0 },
      undefined,
    );

    buildSuggestionsSpy.mockClear();

    await request(app)
      .post('/schemas/suggest-relationships')
      .send({ datasourceIds: [sourceDatasourceId, targetDatasourceId] });
    expect(buildSuggestionsSpy).toHaveBeenCalledTimes(2);
    for (const call of buildSuggestionsSpy.mock.calls) {
      expect(call[4]).toEqual(expectedNamesById);
    }
  });

  it('computes calibration once per run and passes it to buildSuggestions for a single-datasource Generate', async () => {
    const workspaceId = '990e8400-e29b-41d4-a716-446655440000';
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
      total: 2,
    });
    deps.objectDao.sampleForSuggestions.mockResolvedValue({
      total: 0,
      items: [],
    });
    deps.suggestionVerdictDao.listVerdictsForCalibration.mockResolvedValue(
      buildCalibratingVerdicts(),
    );

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
      getWorkspaceId: () => workspaceId,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const buildSuggestionsSpy = vi.mocked(
      suggestRelationshipsService.buildSuggestions,
    );
    buildSuggestionsSpy.mockClear();

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    expect(response.status).toBe(200);
    expect(
      deps.suggestionVerdictDao.listVerdictsForCalibration,
    ).toHaveBeenCalledWith(workspaceId);
    expect(buildSuggestionsSpy).toHaveBeenCalledTimes(1);
    const [, , , , , calibration] = buildSuggestionsSpy.mock.calls[0];
    expect(calibration).toMatchObject({ labelCount: 30 });
    expect(calibration).not.toEqual({ a: 1, b: 0, labelCount: 30 });
  });

  it('degrades to identity calibration and still succeeds when listVerdictsForCalibration rejects', async () => {
    // Scenario 1 from the calibration-hardening review: a corrupt verdict row
    // (e.g. a non-Postgres dialect's JSON.parse throwing in the DAO's row
    // mapper) must never 500 Generate — the read side honors the same
    // "never fail the transition" contract as the verdict-append write side.
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
      total: 2,
    });
    deps.objectDao.sampleForSuggestions.mockResolvedValue({
      total: 0,
      items: [],
    });
    deps.suggestionVerdictDao.listVerdictsForCalibration.mockRejectedValue(
      new Error('corrupt verdict row'),
    );

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
      logger: deps.logger as unknown as LoggerService,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const buildSuggestionsSpy = vi.mocked(
      suggestRelationshipsService.buildSuggestions,
    );
    buildSuggestionsSpy.mockClear();

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    // The handler resolved normally — the rejection never propagated.
    expect(response.status).toBe(200);
    expect(
      deps.suggestionVerdictDao.listVerdictsForCalibration,
    ).toHaveBeenCalledTimes(1);
    expect(buildSuggestionsSpy).toHaveBeenCalledTimes(1);
    const [, , , , , calibration] = buildSuggestionsSpy.mock.calls[0];
    // Identity calibration: baseline scores, unchanged.
    expect(calibration).toEqual({ a: 1, b: 0, labelCount: 0 });
    // A real fit/read bug is logged (distinguishable from "not enough labels",
    // which never throws) — while still degrading to identity.
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('corrupt verdict row'),
    );
  });

  it('computes calibration exactly once per batch run regardless of datasource count, and passes it to every buildSuggestions call', async () => {
    const thirdDatasourceId = '880e8400-e29b-41d4-a716-446655440000';
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [
        { id: sourceDatasourceId },
        { id: targetDatasourceId },
        { id: thirdDatasourceId },
      ],
      total: 3,
    });
    deps.objectDao.sampleForSuggestions.mockResolvedValue({
      total: 0,
      items: [],
    });
    deps.suggestionVerdictDao.listVerdictsForCalibration.mockResolvedValue(
      buildCalibratingVerdicts(),
    );

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use(express.json());
    app.use('/schemas', await controller.getRouter());

    const buildSuggestionsSpy = vi.mocked(
      suggestRelationshipsService.buildSuggestions,
    );
    buildSuggestionsSpy.mockClear();

    const response = await request(app)
      .post('/schemas/suggest-relationships')
      .send({
        datasourceIds: [
          sourceDatasourceId,
          targetDatasourceId,
          thirdDatasourceId,
        ],
      });

    expect(response.status).toBe(200);
    // Three datasources in the batch => three buildSuggestions calls, but
    // the verdict log is fetched and fit exactly once for the whole run.
    expect(buildSuggestionsSpy).toHaveBeenCalledTimes(3);
    expect(
      deps.suggestionVerdictDao.listVerdictsForCalibration,
    ).toHaveBeenCalledTimes(1);
    for (const call of buildSuggestionsSpy.mock.calls) {
      const calibration = call[5];
      expect(calibration).toMatchObject({ labelCount: 30 });
      expect(calibration).not.toEqual({ a: 1, b: 0, labelCount: 30 });
    }
  });

  it('passes identity calibration when the verdict log is empty (pre-Stage-7 baseline control)', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
      total: 2,
    });
    deps.objectDao.sampleForSuggestions.mockResolvedValue({
      total: 0,
      items: [],
    });
    // Explicit — matches createControllerDeps' default, spelled out here to
    // document this test's intent as the identity control.
    deps.suggestionVerdictDao.listVerdictsForCalibration.mockResolvedValue([]);

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const buildSuggestionsSpy = vi.mocked(
      suggestRelationshipsService.buildSuggestions,
    );
    buildSuggestionsSpy.mockClear();

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    expect(response.status).toBe(200);
    expect(
      deps.suggestionVerdictDao.listVerdictsForCalibration,
    ).toHaveBeenCalledTimes(1);
    const [, , , , , calibration] = buildSuggestionsSpy.mock.calls[0];
    expect(calibration).toEqual({ a: 1, b: 0, labelCount: 0 });
  });

  it('returns 500 when the suggest-relationships flow fails', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
    });
    deps.objectDao.sampleForSuggestions.mockRejectedValue(new Error('boom'));

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    expect(response.status).toBe(500);
  });

  it('includes suppressed suggestions with their gate reason in the single-datasource response', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
    });
    mockIdMirrorSample(deps.objectDao);
    deps.relationshipRuleDao.findExistingRule.mockResolvedValue(undefined);

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    expect(response.status).toBe(200);
    expect(response.body.suppressedSuggestions).toHaveLength(1);
    expect(response.body.suppressedSuggestions[0]).toMatchObject({
      sourceField: '$.id',
      targetField: '$.id',
      suppressionReason: 'identity-mirror',
    });
  });

  it('includes suppressed suggestions with their gate reason in each batch result', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
    });
    mockIdMirrorSample(deps.objectDao);
    deps.relationshipRuleDao.findExistingRule.mockResolvedValue(undefined);

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use(express.json());
    app.use('/schemas', await controller.getRouter());

    const response = await request(app)
      .post('/schemas/suggest-relationships')
      .send({ datasourceIds: [sourceDatasourceId, targetDatasourceId] });

    expect(response.status).toBe(200);
    const sourceResult = response.body.results.find(
      (r: { datasourceId: string }) => r.datasourceId === sourceDatasourceId,
    );
    expect(sourceResult.suppressedSuggestions).toHaveLength(1);
    expect(sourceResult.suppressedSuggestions[0]).toMatchObject({
      sourceField: '$.id',
      targetField: '$.id',
      suppressionReason: 'identity-mirror',
    });
  });

  it('caps suppressedSuggestions in the single-datasource response at SUPPRESSED_RESPONSE_CAP', async () => {
    const deps = createControllerDeps();
    deps.catalogWorkflowClient.list.mockResolvedValue({
      data: [{ id: sourceDatasourceId }, { id: targetDatasourceId }],
    });
    // One more field pair than the cap — every pair is trivial-domain
    // suppressed, so the response must truncate rather than pass all through.
    mockManyTrivialDomainPairs(
      deps.objectDao,
      sourceDatasourceId,
      targetDatasourceId,
      SUPPRESSED_RESPONSE_CAP + 1,
    );
    deps.relationshipRuleDao.findExistingRule.mockResolvedValue(undefined);

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService,
    });
    const app = express();
    app.use('/schemas', await controller.getRouter());

    const response = await request(app).post(
      `/schemas/${sourceDatasourceId}/suggest-relationships`,
    );

    expect(response.status).toBe(200);
    expect(response.body.suppressedSuggestions).toHaveLength(
      SUPPRESSED_RESPONSE_CAP,
    );
  });

  it('guards every route with its own scope, and the suggest writes with relationshipRule.create', async () => {
    const deps = createControllerDeps();
    const recordingScopeService = createRecordingScopeService();

    const controller = new SchemaController({
      objectDao: deps.objectDao as unknown as ObjectDao,
      relationshipRuleDao:
        deps.relationshipRuleDao as unknown as RelationshipRuleDao,
      schemaDao: deps.schemaDao as unknown as SchemaDao,
      catalogWorkflowClient:
        deps.catalogWorkflowClient as unknown as CatalogWorkflowClient,
      suggestionVerdictDao:
        deps.suggestionVerdictDao as unknown as SuggestionVerdictDao,
      scopeService: recordingScopeService,
    });
    const byPath = scopesByRoutePath(await controller.getRouter());

    expect(byPath.get('/')).toEqual([SCOPES.catalogDatastore.query]);
    expect(byPath.get('/:datasourceId/latest')).toEqual([
      SCOPES.catalogDatastore.get,
    ]);
    expect(byPath.get('/:datasourceId')).toEqual([SCOPES.catalogDatastore.get]);
    // The two suggest routes persist rules: a read scope would under-guard them.
    expect(byPath.get('/suggest-relationships')).toEqual([
      SCOPES.relationshipRule.create,
    ]);
    expect(byPath.get('/:datasourceId/suggest-relationships')).toEqual([
      SCOPES.relationshipRule.create,
    ]);
  });
});
