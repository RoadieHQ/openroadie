import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';
import type { Page } from '@playwright/test';

// Relationship rules vs. data source re-runs (sc-34243).
//
// A field-matching rule between two runnable data sources materializes
// relations between specific objects. Re-running either side of the rule must
// not lose those relations, and — because a run's publish is expected to
// re-apply the rules that touch the datasource (the AutoApplyCoalescer path) —
// a re-run whose data changes the match set must recompute the relations.
//
// The runnable data sources here are real pipelines (trigger → source →
// datastore sink) executed through the production paged engine. Their input is
// a seeded "fixture" datasource each, read via the `source-datastore` node, so
// the ingested objects are fully controlled and re-runs are deterministic.
const TEST_RUN_ID = Date.now().toString(36);

type FixtureObject = Record<string, unknown> & { name: string };

test.describe('Relationship rule — data source re-runs', () => {
  let backendUrl: string;
  const workflowIds: string[] = [];
  const ruleIds: string[] = [];

  async function createWorkflowShell(page: Page, name: string) {
    const res = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows`,
      {
        data: {
          name,
          description: '',
          workflowType: 'data-ingestion',
          nodes: [],
          edges: [],
          enabled: false,
        },
      },
    );
    expect(res.ok()).toBe(true);
    const id = (await res.json()).data.id;
    workflowIds.push(id);
    return id;
  }

  // The fixture holds the objects a runnable data source will ingest. PUT is a
  // full replace, so each call defines the exact dataset the next run reads.
  async function setFixtureItems(
    page: Page,
    datasourceId: string,
    items: FixtureObject[],
  ) {
    const res = await page.request.put(
      `${backendUrl}/api/catalog-datastore/objects/${datasourceId}`,
      { data: { items: items.map(o => ({ objectId: o.name, object: o })) } },
    );
    expect(res.ok()).toBe(true);
  }

  function pipelineReading(fixtureDatasourceId: string) {
    return {
      nodes: [
        {
          id: 'trigger-node',
          type: 'trigger-schedule',
          position: { x: 0, y: 0 },
          data: {
            label: 'Schedule',
            config: { frequencyValue: 1, frequencyUnit: 'days' },
          },
        },
        {
          id: 'source-node',
          type: 'source-datastore',
          position: { x: 200, y: 0 },
          data: {
            label: 'Data Source',
            config: { datasourceId: fixtureDatasourceId },
          },
        },
        {
          id: 'sink-node',
          type: 'sink-datastore',
          position: { x: 400, y: 0 },
          data: { label: 'Datastore', config: { id_selector: 'name' } },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-node', target: 'source-node' },
        { id: 'e2', source: 'source-node', target: 'sink-node' },
      ],
      enabled: true,
    };
  }

  async function execute(page: Page, workflowId: string) {
    const res = await page.request.post(
      `${backendUrl}/api/catalog-workflow/workflows/${workflowId}/execute`,
      { data: {} },
    );
    expect(res.ok()).toBe(true);
    await expect
      .poll(
        async () => {
          const executions = await page.request.get(
            `${backendUrl}/api/catalog-workflow/workflows/${workflowId}/executions?limit=1`,
          );
          return (await executions.json()).data?.[0]?.status ?? 'none';
        },
        { timeout: 60000 },
      )
      .toBe('completed');
  }

  // The rule's materialized edges as "source->destination" pairs, sorted.
  async function ruleEdges(page: Page, ruleId: string): Promise<string[]> {
    const res = await page.request.get(
      `${backendUrl}/api/catalog-datastore/relationship-rules/${ruleId}/relationships?limit=100`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const list: Array<{
      sourceObjectId: string;
      destinationObjectId: string;
    }> = body.data ?? body.items ?? [];
    return list
      .map(r => `${r.sourceObjectId}->${r.destinationObjectId}`)
      .sort();
  }

  interface Seeded {
    servicesFixture: string;
    teamsFixture: string;
    servicesDs: string;
    teamsDs: string;
    ruleId: string;
  }

  // Two fixtures, two runnable data sources reading them, one applied rule:
  // services.owner —ownedBy→ teams.teamName. Baseline edges:
  // svc-a->team-x, svc-b->team-y.
  async function seedRuleBetweenRunnableDataSources(
    page: Page,
    runId: string,
  ): Promise<Seeded> {
    const servicesFixture = await createWorkflowShell(
      page,
      `E2E Rerun Fixture Services ${runId}`,
    );
    const teamsFixture = await createWorkflowShell(
      page,
      `E2E Rerun Fixture Teams ${runId}`,
    );
    await setFixtureItems(page, servicesFixture, [
      { name: 'svc-a', owner: 'team-x' },
      { name: 'svc-b', owner: 'team-y' },
    ]);
    await setFixtureItems(page, teamsFixture, [
      { name: 'team-x', teamName: 'team-x' },
      { name: 'team-y', teamName: 'team-y' },
    ]);

    const servicesDs = await createWorkflowShell(
      page,
      `E2E Rerun Services DS ${runId}`,
    );
    const teamsDs = await createWorkflowShell(
      page,
      `E2E Rerun Teams DS ${runId}`,
    );
    for (const [id, fixture] of [
      [servicesDs, servicesFixture],
      [teamsDs, teamsFixture],
    ] as const) {
      const res = await page.request.patch(
        `${backendUrl}/api/catalog-workflow/workflows/${id}`,
        { data: pipelineReading(fixture) },
      );
      expect(res.ok()).toBe(true);
    }
    await execute(page, servicesDs);
    await execute(page, teamsDs);

    const ruleRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/relationship-rules`,
      {
        data: {
          name: `E2E Rerun Rule ${runId}`,
          sourceDatasourceId: servicesDs,
          targetDatasourceId: teamsDs,
          sourceFieldExpression: '$.owner',
          targetFieldExpression: '$.teamName',
          relationshipType: 'ownedBy',
          strategy: 'field-matching',
          matchStrategy: 'exact',
        },
      },
    );
    expect(ruleRes.ok()).toBe(true);
    const ruleId = (await ruleRes.json()).id;
    ruleIds.push(ruleId);

    const applyRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/relationship-rules/${ruleId}/apply`,
    );
    expect(applyRes.ok()).toBe(true);
    expect(await ruleEdges(page, ruleId)).toEqual([
      'svc-a->team-x',
      'svc-b->team-y',
    ]);

    return { servicesFixture, teamsFixture, servicesDs, teamsDs, ruleId };
  }

  test.beforeEach(async ({ page }) => {
    backendUrl = await resolveBackendUrl(page.request);
    workflowIds.length = 0;
    ruleIds.length = 0;
  });

  test.afterEach(async ({ page }) => {
    for (const id of ruleIds) {
      await page.request
        .delete(`${backendUrl}/api/catalog-datastore/relationship-rules/${id}`)
        .catch(() => {});
    }
    for (const id of workflowIds) {
      await page.request
        .put(`${backendUrl}/api/catalog-workflow/workflows/${id}`, {
          data: { enabled: false },
        })
        .catch(() => {});
      await page.request
        .delete(`${backendUrl}/api/catalog-workflow/workflows/${id}`)
        .catch(() => {});
    }
  });

  test('relations survive re-running the source and the target data source', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    const runId = `${TEST_RUN_ID}-${testInfo.project.name}`;
    const s = await seedRuleBetweenRunnableDataSources(page, runId);
    const baseline = ['svc-a->team-x', 'svc-b->team-y'];

    // Re-run the SOURCE data source with unchanged data.
    await execute(page, s.servicesDs);
    await page.waitForTimeout(4000); // let any coalesced auto-apply settle
    expect(await ruleEdges(page, s.ruleId)).toEqual(baseline);

    // Re-run the TARGET data source with unchanged data.
    await execute(page, s.teamsDs);
    await page.waitForTimeout(4000);
    expect(await ruleEdges(page, s.ruleId)).toEqual(baseline);

    // Re-run the SOURCE with a changed (but still matching) object, so the
    // publish takes the diff-merge UPDATE path rather than being a no-op.
    await setFixtureItems(page, s.servicesFixture, [
      { name: 'svc-a', owner: 'team-x', note: `changed-${runId}` },
      { name: 'svc-b', owner: 'team-y' },
    ]);
    await execute(page, s.servicesDs);
    await page.waitForTimeout(4000);
    expect(await ruleEdges(page, s.ruleId)).toEqual(baseline);

    // Same on the TARGET side.
    await setFixtureItems(page, s.teamsFixture, [
      { name: 'team-x', teamName: 'team-x', note: `changed-${runId}` },
      { name: 'team-y', teamName: 'team-y' },
    ]);
    await execute(page, s.teamsDs);
    await page.waitForTimeout(4000);
    expect(await ruleEdges(page, s.ruleId)).toEqual(baseline);

    // And the relation the user sees: the routed object detail page for svc-a
    // lists its team-x relationship under the "Owned by" kind section.
    await page.goto(`/datastore/${s.servicesDs}/svc-a`);
    await expect(
      page.getByRole('region', { name: 'Owned by' }).getByText('team-x'),
    ).toBeVisible({ timeout: 15000 });
  });

  // sc-34243: a data source run's publish must re-apply the rules that touch
  // the datasource, exactly like the datastore API's replaceDatasourceItems
  // does (AutoApplyCoalescer). The paged engine publishes via StagedPublisher,
  // which carries no side effects of its own — the datastore backend's
  // WorkflowSyncSubscriber drives them from the run's sync event instead.
  // This test is the regression guard for that wiring: without it, relations
  // go permanently stale the moment a re-run changes the match set.
  test('a re-run whose data changes the match set recomputes the relations', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    const runId = `${TEST_RUN_ID}-recompute-${testInfo.project.name}`;
    const s = await seedRuleBetweenRunnableDataSources(page, runId);

    // svc-a vanishes for one run: its row is deleted and the relation
    // cascades away with it. That much is by design.
    await setFixtureItems(page, s.servicesFixture, [
      { name: 'svc-b', owner: 'team-y' },
    ]);
    await execute(page, s.servicesDs);
    await expect
      .poll(async () => ruleEdges(page, s.ruleId), { timeout: 30000 })
      .toEqual(['svc-b->team-y']);

    // svc-a returns on the next run — the rule must be re-applied so its
    // relation comes back without a manual apply.
    await setFixtureItems(page, s.servicesFixture, [
      { name: 'svc-a', owner: 'team-x' },
      { name: 'svc-b', owner: 'team-y' },
    ]);
    await execute(page, s.servicesDs);
    await expect
      .poll(async () => ruleEdges(page, s.ruleId), { timeout: 30000 })
      .toEqual(['svc-a->team-x', 'svc-b->team-y']);

    // A brand-new matching object must also materialize its relation.
    await setFixtureItems(page, s.servicesFixture, [
      { name: 'svc-a', owner: 'team-x' },
      { name: 'svc-b', owner: 'team-y' },
      { name: 'svc-c', owner: 'team-x' },
    ]);
    await execute(page, s.servicesDs);
    await expect
      .poll(async () => ruleEdges(page, s.ruleId), { timeout: 30000 })
      .toEqual(['svc-a->team-x', 'svc-b->team-y', 'svc-c->team-x']);
  });
});
