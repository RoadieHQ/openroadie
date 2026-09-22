import {
  suggestRelationships,
  approveRules,
  rejectRules,
  resetRules,
  createRule,
  linkRelationship,
  reviewSuggested,
  discoverEnabledDatasourceIds,
  listRules,
  fetchRule,
  updateRule,
  formatEvidenceLines,
} from './relationships';
import { OpenRoadieHttpClient } from '../http-client';
import { ENDPOINTS } from '../status';
import type { OpenRoadieConfig } from '../config';

const CONFIG: OpenRoadieConfig = { backendUrl: 'http://localhost:7008' };
const DS_A = '11111111-1111-1111-1111-111111111111';
const DS_B = '22222222-2222-2222-2222-222222222222';

interface Call {
  url: string;
  method?: string;
  body?: unknown;
}

function routingFetch(
  calls: Call[],
  handler: (url: string, method: string) => { status: number; body?: unknown },
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const { status, body } = handler(url, method);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
      text: async () => JSON.stringify(body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('suggestRelationships', () => {
  it('tallies confidence from the rules actually created, not the inflated match list', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: {
          // The per-source match list double-counts reciprocal + suppressed
          // matches (six highs here), but only three rules were created.
          results: [
            {
              datasourceId: DS_A,
              total: 6,
              suggestions: [
                { confidenceBand: 'high' },
                { confidenceBand: 'high' },
                { confidenceBand: 'high' },
                { confidenceBand: 'high' },
                { confidenceBand: 'high' },
                { confidenceBand: 'high' },
              ],
            },
          ],
          createdRules: [
            { id: 'r1', confidenceBand: 'high' },
            { id: 'r2', confidenceBand: 'medium' },
            { id: 'r3', confidenceBand: 'low' },
          ],
        },
      })),
    );

    const result = await suggestRelationships(client, [DS_A, DS_B]);

    expect(calls[0].url).toBe(
      `http://localhost:7008${ENDPOINTS.suggestRelationships}`,
    );
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ datasourceIds: [DS_A, DS_B] });

    expect(result.status).toBe('suggested');
    expect(result.createdRuleIds).toEqual(['r1', 'r2', 'r3']);
    // From the 3 created rules — NOT the 6-high match list.
    expect(result.confidence).toEqual({ high: 1, medium: 1, low: 1 });
    // A medium/low rule exists → human review is required.
    expect(result.needsReview).toBe(true);
  });

  it('does not gate review when every created rule is high confidence', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: {
          createdRules: [{ id: 'r1', confidenceBand: 'high' }],
        },
      })),
    );

    const result = await suggestRelationships(client, [DS_A]);
    expect(result.confidence).toEqual({ high: 1, medium: 0, low: 0 });
    expect(result.needsReview).toBe(false);
  });

  it('summarises a run by datasource pair', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          results: [],
          pairs: [
            {
              datasourceIds: [DS_A, DS_B],
              suggestions: [
                { confidenceBand: 'high' },
                { confidenceBand: 'low' },
              ],
            },
          ],
          createdRules: [{ id: 'r1', confidenceBand: 'high' }],
        },
      })),
    );

    const result = await suggestRelationships(client, [DS_A, DS_B]);

    expect(result.pairs).toEqual([
      { datasourceIds: [DS_A, DS_B], suggestionCount: 2 },
    ]);
  });

  it('reports no pairs when the backend omits the grouping', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          results: [],
          createdRules: [{ id: 'r1', confidenceBand: 'high' }],
        },
      })),
    );

    const result = await suggestRelationships(client, [DS_A, DS_B]);

    expect(result.pairs).toEqual([]);
  });
});

describe('discoverEnabledDatasourceIds', () => {
  it('returns the ids of every enabled data-ingestion workflow', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: { data: [{ id: DS_A }, { id: DS_B }] },
      })),
    );

    const ids = await discoverEnabledDatasourceIds(client);

    expect(calls[0].url).toBe(
      `http://localhost:7008${ENDPOINTS.workflows}?workflowType=data-ingestion&enabled=true&limit=200`,
    );
    expect(ids).toEqual([DS_A, DS_B]);
  });
});

describe('approveRules / rejectRules', () => {
  it('approve hits POST /relationship-rules/approve once with every id (bulk route)', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: { approved: ['r1', 'r2'], dismissedAsInverse: [], failed: [] },
      })),
    );

    const result = await approveRules(client, ['r1', 'r2'], {});

    const posts = calls.filter(call => call.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(
      `http://localhost:7008${ENDPOINTS.relationshipRules}/approve`,
    );
    expect(posts[0].body).toEqual({ ids: ['r1', 'r2'] });
    expect(result.status).toBe('done');
    expect(result.targetState).toBe('active');
    expect(result.succeeded).toEqual(['r1', 'r2']);
  });

  it('reject hits /:id/dismiss (→ inactive) for each id', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200, body: { state: 'inactive' } })),
    );

    const result = await rejectRules(client, ['r1'], {});

    const post = calls.find(call => call.method === 'POST');
    expect(post?.url).toBe(
      `http://localhost:7008${ENDPOINTS.relationshipRules}/r1/dismiss`,
    );
    expect(result.targetState).toBe('inactive');
    expect(result.succeeded).toEqual(['r1']);
  });

  // The failure reason comes from the shared `httpFailureReason`, same as
  // `approveRules` / `resetRules`, so it surfaces the backend's own message.
  it('reject reports partial when one of several /dismiss calls fails', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], url =>
        url.endsWith('/r2/dismiss')
          ? { status: 500, body: { error: 'boom' } }
          : { status: 200, body: { state: 'inactive' } },
      ),
    );

    const result = await rejectRules(client, ['r1', 'r2'], {});

    expect(result.status).toBe('partial');
    expect(result.succeeded).toEqual(['r1']);
    expect(result.failed).toEqual([{ id: 'r2', reason: '{"error":"boom"}' }]);
  });

  it('reject reports failed when every /dismiss call fails', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({ status: 500, body: { error: 'boom' } })),
    );

    const result = await rejectRules(client, ['r1', 'r2'], {});

    expect(result.status).toBe('failed');
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { id: 'r1', reason: '{"error":"boom"}' },
      { id: 'r2', reason: '{"error":"boom"}' },
    ]);
  });

  it('reports partial when the bulk response tallies some ids as failed', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          approved: ['r1', 'r3'],
          dismissedAsInverse: [],
          failed: [{ id: 'r2', reason: 'status 500' }],
        },
      })),
    );

    const result = await approveRules(client, ['r1', 'r2', 'r3'], {});

    expect(result.status).toBe('partial');
    expect(result.succeeded).toEqual(['r1', 'r3']);
    expect(result.failed).toEqual([{ id: 'r2', reason: 'status 500' }]);
  });

  it('reports failed when the bulk response tallies every id as failed', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          approved: [],
          dismissedAsInverse: [],
          failed: [
            { id: 'r1', reason: 'status 500' },
            { id: 'r2', reason: 'status 500' },
          ],
        },
      })),
    );

    const result = await approveRules(client, ['r1', 'r2'], {});

    expect(result.status).toBe('failed');
    expect(result.succeeded).toEqual([]);
    expect(result.failed.map(f => f.id)).toEqual(['r1', 'r2']);
  });

  it('reports failed when the bulk request itself fails', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({ status: 500 })),
    );

    const result = await approveRules(client, ['r1', 'r2'], {});

    expect(result.status).toBe('failed');
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.reason).toBeTruthy();
  });

  // A 200 whose body has no usable `approved` array must not be reported as
  // `done` with nothing approved — that would claim success having approved
  // nothing (the bug two reviewers flagged).
  it('reports failed, not done, when a 200 response has no usable "approved" array', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({ status: 200, body: {} })),
    );

    const result = await approveRules(client, ['r1', 'r2'], {});

    expect(result.status).toBe('failed');
    expect(result.succeeded).toEqual([]);
    expect(result.reason).toBeTruthy();
  });

  it('still reports noop for an empty request, not the malformed-response failure', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({ status: 200, body: {} })),
    );

    const result = await approveRules(client, [], {});

    expect(result.status).toBe('noop');
    expect(result.reason).toBe('no rule ids given');
  });

  it('--all lists ?state=suggested then approves every returned id in one bulk request', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (url, method) => {
        if (method === 'GET') {
          return {
            status: 200,
            body: {
              items: [
                { id: 'r1', state: 'suggested' },
                { id: 'r2', state: 'suggested' },
              ],
              total: 2,
            },
          };
        }
        return {
          status: 200,
          body: { approved: ['r1', 'r2'], dismissedAsInverse: [], failed: [] },
        };
      }),
    );

    const result = await approveRules(client, [], { all: true });

    expect(calls[0].url).toBe(
      `http://localhost:7008${ENDPOINTS.relationshipRules}?state=suggested&limit=10000`,
    );
    expect(calls[0].method).toBe('GET');
    expect(calls[1].url).toBe(
      `http://localhost:7008${ENDPOINTS.relationshipRules}/approve`,
    );
    expect(calls[1].body).toEqual({ ids: ['r1', 'r2'] });
    expect(result.succeeded).toEqual(['r1', 'r2']);
  });
});

describe('approveRules via the bulk route', () => {
  it('sends every id in a single request and reports suppressed mirrors', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: { approved: ['a'], dismissedAsInverse: ['b'], failed: [] },
      })),
    );

    const result = await approveRules(client, ['a', 'b'], {});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/relationship-rules/approve');
    expect(calls[0].body).toEqual({ ids: ['a', 'b'] });
    expect(result.status).toBe('done');
    expect(result.succeeded).toEqual(['a']);
    expect(result.dismissedAsInverse).toEqual(['b']);
  });

  // A mirror the caller never named that could not be suppressed is a manual
  // chore, not a failure of this request: it must stay out of `failed` (which
  // is what the exit code counts).
  it('keeps unsuppressible mirrors out of `failed`', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          approved: ['a'],
          dismissedAsInverse: [],
          failed: [],
          inverseDismissFailed: [{ id: 'mirror-1', reason: 'db locked' }],
        },
      })),
    );

    const result = await approveRules(client, ['a'], {});

    expect(result.status).toBe('done');
    expect(result.failed).toEqual([]);
    expect(result.inverseDismissFailed).toEqual([
      { id: 'mirror-1', reason: 'db locked' },
    ]);
  });

  it('reports per-id failures as partial', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({
        status: 200,
        body: {
          approved: ['a'],
          dismissedAsInverse: [],
          failed: [
            {
              id: 'b',
              reason: "Rule is currently 'active', expected 'suggested'",
            },
          ],
        },
      })),
    );

    const result = await approveRules(client, ['a', 'b'], {});

    expect(result.status).toBe('partial');
    expect(result.failed).toEqual([
      { id: 'b', reason: "Rule is currently 'active', expected 'suggested'" },
    ]);
  });
});

describe('resetRules', () => {
  it('posts each id to its reset route', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200, body: {} })),
    );

    const result = await resetRules(client, ['a', 'b']);

    expect(calls.map(c => c.url)).toEqual([
      expect.stringContaining('/relationship-rules/a/reset'),
      expect.stringContaining('/relationship-rules/b/reset'),
    ]);
    expect(result.succeeded).toEqual(['a', 'b']);
  });
});

describe('reviewSuggested', () => {
  it('drives the review screen from the ?state=suggested rules', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: {
          items: [
            { id: 'r1', name: 'GitHub → Owner', relationshipType: 'ownedBy' },
          ],
          total: 1,
        },
      })),
    );

    const result = await reviewSuggested(client);

    expect(calls[0].url).toBe(
      `http://localhost:7008${ENDPOINTS.relationshipRules}?state=suggested&limit=10000`,
    );
    expect(result.status).toBe('ok');
    expect(result.pending).toEqual([
      { id: 'r1', name: 'GitHub → Owner', relationshipType: 'ownedBy' },
    ]);
    expect(result.needsReview).toBe(true);
  });

  it('reports no review needed when nothing is suggested', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: { items: [], total: 0 },
      })),
    );

    const result = await reviewSuggested(client);
    expect(result.pending).toEqual([]);
    expect(result.needsReview).toBe(false);
  });
});

describe('createRule', () => {
  it('POSTs the rule body to the same endpoint the MCP tool uses, dropping undefined optionals', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 201,
        body: {
          id: 'rule-1',
          name: 'GitHub login → person',
          state: 'active',
          relationshipType: 'memberOf',
        },
      })),
    );

    const result = await createRule(client, {
      name: 'GitHub login → person',
      sourceDatasourceId: DS_A,
      targetDatasourceId: DS_B,
      sourceFieldExpression: '$.login',
      targetFieldExpression: '$.email',
      relationshipType: 'memberOf',
      matchStrategy: 'exact',
    });

    expect(result.status).toBe('created');
    expect(result.rule?.id).toBe('rule-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain(ENDPOINTS.relationshipRules);
    // undefined optionals (description, filters, …) must not reach the body.
    expect(calls[0].body).toEqual({
      name: 'GitHub login → person',
      sourceDatasourceId: DS_A,
      targetDatasourceId: DS_B,
      sourceFieldExpression: '$.login',
      targetFieldExpression: '$.email',
      relationshipType: 'memberOf',
      matchStrategy: 'exact',
    });
  });

  it('fails cleanly when the backend rejects the rule', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({ status: 400, body: { error: 'bad expr' } })),
    );

    const result = await createRule(client, {
      name: 'broken',
      sourceDatasourceId: DS_A,
      targetDatasourceId: DS_B,
      sourceFieldExpression: '$.x',
      targetFieldExpression: '$.y',
      relationshipType: 'rel',
    });

    expect(result.status).toBe('failed');
    expect(result.rule).toBeUndefined();
    expect(result.reason).toBeTruthy();
  });

  it('POSTs valid integration-backed rules with integration config', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 201,
        body: {
          id: 'rule-1',
          name: 'Repo → owner via GitHub',
          state: 'active',
          relationshipType: 'ownedBy',
        },
      })),
    );

    const integrationConfig = {
      integrationId: 'github',
      path: '/repos/${source.fullName}/collaborators',
      responseMatchExpression: '$[login = target.login]',
    };
    const result = await createRule(client, {
      name: 'Repo → owner via GitHub',
      sourceDatasourceId: DS_A,
      targetDatasourceId: DS_B,
      sourceFieldExpression: '$.fullName',
      targetFieldExpression: '$.login',
      relationshipType: 'ownedBy',
      strategy: 'integration-backed',
      integrationConfig,
    });

    expect(result.status).toBe('created');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      name: 'Repo → owner via GitHub',
      sourceDatasourceId: DS_A,
      targetDatasourceId: DS_B,
      sourceFieldExpression: '$.fullName',
      targetFieldExpression: '$.login',
      relationshipType: 'ownedBy',
      strategy: 'integration-backed',
      integrationConfig,
    });
  });

  it('rejects integration-backed rules without required config before POST', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 201, body: { id: 'rule-1' } })),
    );

    const result = await createRule(client, {
      name: 'broken',
      sourceDatasourceId: DS_A,
      targetDatasourceId: DS_B,
      sourceFieldExpression: '$.x',
      targetFieldExpression: '$.y',
      relationshipType: 'rel',
      strategy: 'integration-backed',
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('require --integration-config');
    expect(calls).toHaveLength(0);
  });

  it('rejects field-matching rules with integration config before POST', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 201, body: { id: 'rule-1' } })),
    );

    const result = await createRule(client, {
      name: 'broken',
      sourceDatasourceId: DS_A,
      targetDatasourceId: DS_B,
      sourceFieldExpression: '$.x',
      targetFieldExpression: '$.y',
      relationshipType: 'rel',
      strategy: 'field-matching',
      integrationConfig: {
        integrationId: 'github',
        path: '/x',
        responseMatchExpression: '$',
      },
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('field-matching');
    expect(calls).toHaveLength(0);
  });
});

describe('relationship rule triage view', () => {
  const RULE = {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    name: 'github → shortcut',
    state: 'suggested',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    relationshipType: 'sameAs',
    sourceDatasourceId: DS_A,
    targetDatasourceId: DS_B,
    sourceFieldExpression: '$.login',
    targetFieldExpression: '$.mention_name',
    confidenceBand: 'high',
    score: 0.92,
    evidenceSummary: {
      explanation: '47 distinct values, both identifier-like',
    },
  };

  function client(items: unknown[], calls: Call[] = []) {
    return new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, url =>
        url.includes('/workflows')
          ? {
              status: 200,
              body: {
                data: [
                  { id: DS_A, name: 'github' },
                  { id: DS_B, name: 'shortcut' },
                ],
              },
            }
          : { status: 200, body: { items } },
      ),
    );
  }

  it('carries score and the evidence one-liner into the result payload', async () => {
    const result = await listRules(client([RULE]), {});
    expect(result.rules[0]).toMatchObject({
      score: 0.92,
      confidenceBand: 'high',
      explanation: '47 distinct values, both identifier-like',
      source: 'github.$.login',
    });
  });

  it('filters to a single confidence band', async () => {
    const low = {
      ...RULE,
      id: 'bbbbbbbb-1111-1111-1111-111111111111',
      confidenceBand: 'low',
      score: 0.2,
    };
    const result = await listRules(client([RULE, low]), { band: 'high' });
    expect(result.rules.map(r => r.confidenceBand)).toEqual(['high']);
  });

  it('fetches one rule by id for show', async () => {
    const calls: Call[] = [];
    const c = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200, body: RULE })),
    );
    const outcome = await fetchRule(c, RULE.id);
    expect(calls[0].url).toContain(`/relationship-rules/${RULE.id}`);
    expect(outcome.ok && outcome.rule.score).toBe(0.92);
  });

  it('reports a 404 as not found', async () => {
    const c = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], () => ({ status: 404, body: { error: 'Not found' } })),
    );
    const outcome = await fetchRule(c, RULE.id);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.notFound).toBe(true);
  });

  // A truncated id (400) or a broken backend (500) is NOT "no such rule" — the
  // old code reported every non-2xx as missing, sending the caller hunting for
  // a rule that exists.
  it.each([
    [400, 'Invalid rule ID format'],
    [500, 'boom'],
  ])(
    'surfaces a %d as a real failure, not "not found"',
    async (status, err) => {
      const c = new OpenRoadieHttpClient(
        CONFIG,
        routingFetch([], () => ({ status, body: { error: err } })),
      );
      const outcome = await fetchRule(c, 'aaaaaaaa');
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.notFound).toBe(false);
      expect(outcome.status).toBe(status);
      expect(outcome.reason).toContain(err);
    },
  );

  it('surfaces an unreachable backend rather than claiming the rule is missing', async () => {
    const c = new OpenRoadieHttpClient(CONFIG, (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch);
    const outcome = await fetchRule(c, RULE.id);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.notFound).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('backend unreachable');
  });

  describe('formatEvidenceLines (show evidence block)', () => {
    it('renders only the original fields when gate/waterfall/rescue are absent', () => {
      const lines = formatEvidenceLines(RULE.evidenceSummary);

      expect(lines).toEqual([
        '  evidence',
        '    47 distinct values, both identifier-like',
        '    value types: -',
        '    distinct matched values: -',
        '    common-value penalty: -',
        '    samples: -',
      ]);
      // Backward compat: no new section headers when the fields are absent.
      expect(lines.join('\n')).not.toContain('waterfall');
      expect(lines.join('\n')).not.toContain('gate');
      expect(lines.join('\n')).not.toContain('rescued');
    });

    it('renders waterfall signals with signed weights, gate containment, and the rescue hint', () => {
      const lines = formatEvidenceLines({
        ...RULE.evidenceSummary,
        waterfall: [
          { signal: 'containment', fired: true, weight: 8.113 },
          {
            signal: 'name-similarity',
            fired: false,
            weight: -2.5,
            detail: 'no overlap',
          },
        ],
        gate: {
          containment: 0.99,
          containmentDirection: 'source-to-target',
          containmentVerified: true,
          referencedCardinalityRatio: 1.2,
          rescueHint: 'try a transform on source field',
        },
        rescue: {
          kind: 'transform',
          detail: 'stripped a "gh-" prefix before matching',
          originalField: '$.raw_login',
        },
      });
      const rendered = lines.join('\n');

      expect(rendered).toContain('waterfall');
      expect(rendered).toContain('containment  +8.113');
      expect(rendered).toContain('name-similarity  -2.500 (no overlap)');
      expect(rendered).toContain('gate:');
      expect(rendered).toContain('containment 0.990 (source-to-target)');
      expect(rendered).toContain('verified true');
      expect(rendered).toContain('cardinality ratio 1.200');
      expect(rendered).toContain(
        'gate rescue hint: try a transform on source field',
      );
      expect(rendered).toContain(
        'rescued via transform: stripped a "gh-" prefix before matching (originally $.raw_login)',
      );
    });

    it('shows all waterfall entries including penalty signals beyond the first 8', () => {
      const lines = formatEvidenceLines({
        ...RULE.evidenceSummary,
        waterfall: [
          { signal: 'containment', fired: true, weight: 8.113 },
          { signal: 'name-similarity', fired: true, weight: 3.2 },
          { signal: 'value-count', fired: true, weight: 2.1 },
          { signal: 'type-consistency', fired: true, weight: 1.5 },
          { signal: 'index-density', fired: true, weight: 0.9 },
          { signal: 'cardinality-ratio', fired: true, weight: 0.7 },
          { signal: 'frequency-correlation', fired: true, weight: 0.4 },
          { signal: 'pattern-match', fired: false, weight: -0.8 },
          // Penalty signals that should appear when there are >8 entries
          {
            signal: 'semantic-incompatible',
            fired: false,
            weight: -4.2,
            detail: 'field types conflict',
          },
          {
            signal: 'fan-out-sanity',
            fired: false,
            weight: -3.5,
            detail: 'cardinality mismatch',
          },
          {
            signal: 'null-prevalence',
            fired: false,
            weight: -1.1,
          },
        ],
      });
      const rendered = lines.join('\n');

      expect(rendered).toContain('waterfall');
      // Early entries
      expect(rendered).toContain('containment  +8.113');
      expect(rendered).toContain('name-similarity  +3.200');
      // Penalty signals (entries 9-11) that would be lost with slice(0, 8)
      expect(rendered).toContain(
        'semantic-incompatible  -4.200 (field types conflict)',
      );
      expect(rendered).toContain(
        'fan-out-sanity  -3.500 (cardinality mismatch)',
      );
      expect(rendered).toContain('null-prevalence  -1.100');
    });

    it('renders source/target field stats and semantic evidence when present', () => {
      const lines = formatEvidenceLines({
        ...RULE.evidenceSummary,
        sourceFieldStats: {
          distinctCount: 47,
          rowCoverage: 0.98,
          cardinalityRatio: 0.995,
          looksEnumLike: false,
          isIdentifierLike: true,
        },
        targetFieldStats: {
          distinctCount: 40,
          rowCoverage: 0.6,
          cardinalityRatio: 0.5,
          looksEnumLike: true,
          isIdentifierLike: false,
        },
        sourceFieldSemantic: 'email',
        targetFieldSemantic: 'email',
        semanticCompatibility: 'same-domain',
      });
      const rendered = lines.join('\n');

      expect(rendered).toContain(
        'source field: distinct 47, coverage 0.980, cardinality 0.995, enum-like false, identifier-like true',
      );
      expect(rendered).toContain(
        'target field: distinct 40, coverage 0.600, cardinality 0.500, enum-like true, identifier-like false',
      );
      expect(rendered).toContain(
        'semantic: source=email, target=email, compatibility=same-domain',
      );
    });

    it('omits field stats and semantic lines when absent (backward compat)', () => {
      const lines = formatEvidenceLines(RULE.evidenceSummary);
      const rendered = lines.join('\n');

      expect(rendered).not.toContain('source field:');
      expect(rendered).not.toContain('target field:');
      expect(rendered).not.toContain('semantic:');
    });

    it('flags overflow past 8 sample values with a "+N more" suffix', () => {
      const lines = formatEvidenceLines({
        ...RULE.evidenceSummary,
        topMatchedValues: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      });

      expect(lines).toContainEqual(
        '    samples: a, b, c, d, e, f, g, h … (+2 more)',
      );
    });

    it('does not add a "+N more" suffix at or under 8 sample values', () => {
      const lines = formatEvidenceLines({
        ...RULE.evidenceSummary,
        topMatchedValues: ['a', 'b', 'c'],
      });

      expect(lines).toContainEqual('    samples: a, b, c');
    });
  });
});

describe('updateRule', () => {
  it('PUTs only the flags that were given', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200, body: { id: 'r1' } })),
    );

    await updateRule(client, 'r1', { relationshipType: 'ownedBy' });

    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain('/relationship-rules/r1');
    expect(calls[0].body).toEqual({ relationshipType: 'ownedBy' });
  });

  it('sends an integration config through unchanged', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200, body: { id: 'r1' } })),
    );
    const integrationConfig = {
      integrationId: '33333333-3333-4333-8333-333333333333',
      path: '/users/{value}',
      responseMatchExpression: 'login',
    };

    await updateRule(client, 'r1', { integrationConfig });

    expect(calls[0].body).toEqual({ integrationConfig });
  });

  it('sends null for a cleared field so the backend nulls the column', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200, body: { id: 'r1' } })),
    );

    await updateRule(client, 'r1', { sourceFilterExpression: null });

    expect(calls[0].body).toEqual({ sourceFilterExpression: null });
  });

  // `--source-filter ''` used to store an empty string; `--relationship ''`
  // would have blanked a live rule's relationship type outright.
  it.each([
    ['sourceFilterExpression', '--clear-source-filter'],
    ['description', '--clear-description'],
    ['reciprocalRelationshipType', '--clear-reciprocal'],
    ['targetFilterExpression', '--clear-target-filter'],
  ])(
    'refuses an empty %s and points at its clear flag',
    async (field, clearFlag) => {
      const calls: Call[] = [];
      const client = new OpenRoadieHttpClient(
        CONFIG,
        routingFetch(calls, () => ({ status: 200, body: { id: 'r1' } })),
      );

      const result = await updateRule(client, 'r1', { [`${field}`]: '' });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain(clearFlag);
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    ['relationshipType', '--relationship'],
    ['name', '--name'],
    ['sourceFieldExpression', '--source-field'],
  ])(
    'refuses an empty %s, which cannot be cleared at all',
    async (field, flag) => {
      const calls: Call[] = [];
      const client = new OpenRoadieHttpClient(
        CONFIG,
        routingFetch(calls, () => ({ status: 200, body: { id: 'r1' } })),
      );

      const result = await updateRule(client, 'r1', { [`${field}`]: '' });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain(flag);
      expect(result.reason).toContain('omit it');
      expect(calls).toHaveLength(0);
    },
  );

  it('refuses an empty patch without calling the backend', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200 })),
    );

    const result = await updateRule(client, 'r1', {});

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('linkRelationship', () => {
  it('PUTs a manual one-off edge to the relationships endpoint with origin manual', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({
        status: 200,
        body: { id: 'rel-1', origin: 'manual' },
      })),
    );

    const result = await linkRelationship(client, {
      sourceDatasourceId: DS_A,
      sourceObjectId: 'obj-a',
      targetDatasourceId: DS_B,
      targetObjectId: 'obj-b',
      relationshipType: 'samePersonAs',
      reciprocalRelationshipType: 'samePersonAs',
      metadata: { note: 'confirmed' },
    });

    expect(result.status).toBe('done');
    expect(result.id).toBe('rel-1');
    expect(result.origin).toBe('manual');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain(ENDPOINTS.relationships);
    expect(calls[0].body).toMatchObject({
      sourceDatasourceId: DS_A,
      sourceObjectId: 'obj-a',
      destinationDatasourceId: DS_B,
      destinationObjectId: 'obj-b',
      relationshipType: 'samePersonAs',
      origin: 'manual',
      metadata: { note: 'confirmed' },
    });
  });

  it('reports failure when the endpoint rejects', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 400, body: { error: 'bad' } })),
    );
    const result = await linkRelationship(client, {
      sourceDatasourceId: DS_A,
      sourceObjectId: 'obj-a',
      targetDatasourceId: DS_B,
      targetObjectId: 'obj-b',
      relationshipType: 'samePersonAs',
    });
    expect(result.status).toBe('failed');
  });
});
