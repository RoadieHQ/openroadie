import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';
import type { Page } from '@playwright/test';

// A data source run's publish must end in the same delta-gated side effects
// as the datastore API's replace (sc-34243): datasource-changed (context
// groups, webhooks) and the activity marker. The relationship auto-apply half
// has its own spec (relationship-rule-datasource-rerun.spec.ts); these three
// tests pin the other riders of the same lever, end to end through the paged
// engine:
//   1. context groups re-materialize after a re-run changes the edges,
//   2. an empty first run still marks the datasource as synced,
//   3. a registered webhook receives a delivery after a changed run.
const TEST_RUN_ID = Date.now().toString(36);

type FixtureObject = Record<string, unknown> & { name: string };

test.describe('Data source run — publish side effects', () => {
  let backendUrl: string;
  const workflowIds: string[] = [];
  const contextRuleIds: string[] = [];
  const relationshipRuleIds: string[] = [];

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

  async function createRunnableDataSource(
    page: Page,
    name: string,
    fixtureDatasourceId: string,
  ) {
    const id = await createWorkflowShell(page, name);
    const res = await page.request.patch(
      `${backendUrl}/api/catalog-workflow/workflows/${id}`,
      { data: pipelineReading(fixtureDatasourceId) },
    );
    expect(res.ok()).toBe(true);
    return id;
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

  test.beforeEach(async ({ page }) => {
    backendUrl = await resolveBackendUrl(page.request);
    workflowIds.length = 0;
    contextRuleIds.length = 0;
    relationshipRuleIds.length = 0;
  });

  test.afterEach(async ({ page }) => {
    for (const id of contextRuleIds) {
      await page.request
        .delete(
          `${backendUrl}/api/catalog-datastore/context-groups/rules/${id}`,
        )
        .catch(() => {});
    }
    for (const id of relationshipRuleIds) {
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

  test('context groups re-materialize after a data source re-run changes the edges', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    const runId = `${TEST_RUN_ID}-cg-${testInfo.project.name}`;

    const servicesFixture = await createWorkflowShell(
      page,
      `E2E SideFx CG Fixture Services ${runId}`,
    );
    const teamsFixture = await createWorkflowShell(
      page,
      `E2E SideFx CG Fixture Teams ${runId}`,
    );
    await setFixtureItems(page, servicesFixture, [
      { name: 'svc-a', owner: 'team-x' },
      { name: 'svc-b', owner: 'team-y' },
    ]);
    await setFixtureItems(page, teamsFixture, [
      { name: 'team-x', teamName: 'team-x' },
      { name: 'team-y', teamName: 'team-y' },
    ]);
    const servicesDs = await createRunnableDataSource(
      page,
      `E2E SideFx CG Services DS ${runId}`,
      servicesFixture,
    );
    const teamsDs = await createRunnableDataSource(
      page,
      `E2E SideFx CG Teams DS ${runId}`,
      teamsFixture,
    );
    await execute(page, servicesDs);
    await execute(page, teamsDs);

    const ruleRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/relationship-rules`,
      {
        data: {
          name: `E2E SideFx CG Rule ${runId}`,
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
    relationshipRuleIds.push((await ruleRes.json()).id);
    const applyRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/relationship-rules/${relationshipRuleIds[0]}/apply`,
    );
    expect(applyRes.ok()).toBe(true);

    // A context group over both datasources, merging along the rule's edges.
    // Creation materializes it, so the baseline groups are readable at once.
    const contextRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/context-groups/rules`,
      {
        data: {
          name: `E2E SideFx Ownership ${runId}`,
          datasources: [
            { datasourceId: servicesDs },
            { datasourceId: teamsDs },
          ],
          mergeRelationshipTypes: ['ownedBy'],
        },
      },
    );
    expect(contextRes.ok()).toBe(true);
    const contextRuleId = (await contextRes.json()).id;
    contextRuleIds.push(contextRuleId);

    // Sorted member sets, sorted by first member — order-independent identity.
    async function memberSets(): Promise<string[][]> {
      const res = await page.request.get(
        `${backendUrl}/api/catalog-datastore/context-groups/rules/${contextRuleId}/groups`,
      );
      if (!res.ok()) return [];
      const body = await res.json();
      const groups: Array<{ members: Array<{ objectId: string }> }> =
        body.groups ?? [];
      return groups
        .map(group => group.members.map(m => m.objectId).sort())
        .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
    }

    await expect.poll(memberSets, { timeout: 30000 }).toEqual([
      ['svc-a', 'team-x'],
      ['svc-b', 'team-y'],
    ]);

    // svc-a changes owner; the RUN alone must carry that all the way through:
    // publish → auto-apply (edge moves) → context-group re-materialization.
    await setFixtureItems(page, servicesFixture, [
      { name: 'svc-a', owner: 'team-y' },
      { name: 'svc-b', owner: 'team-y' },
    ]);
    await execute(page, servicesDs);

    await expect
      .poll(memberSets, { timeout: 45000 })
      .toEqual([['svc-a', 'svc-b', 'team-y'], ['team-x']]);
  });

  test('an empty first run still marks the datasource as synced', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const runId = `${TEST_RUN_ID}-empty-${testInfo.project.name}`;

    const emptyFixture = await createWorkflowShell(
      page,
      `E2E SideFx Empty Fixture ${runId}`,
    );
    // Sync the fixture as empty so the run's source reads an empty dataset.
    await setFixtureItems(page, emptyFixture, []);
    const emptyDs = await createRunnableDataSource(
      page,
      `E2E SideFx Empty DS ${runId}`,
      emptyFixture,
    );

    const since = new Date(Date.now() - 1000).toISOString();
    await execute(page, emptyDs);

    // The reconciliation surface reads the activity marker — the row a no-op
    // publish must still create so "synced but empty" ≠ "never synced".
    const tokenRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/webhooks/tokens`,
      { data: { label: `e2e-side-effects-${runId}` } },
    );
    expect(tokenRes.ok()).toBe(true);
    const token = (await tokenRes.json()) as { id: string; token: string };
    try {
      await expect
        .poll(
          async () => {
            const res = await page.request.get(
              `${backendUrl}/api/datasources?updated_since=${encodeURIComponent(since)}`,
              { headers: { authorization: `Bearer ${token.token}` } },
            );
            if (!res.ok()) return false;
            const body = (await res.json()) as {
              items: Array<{ datasourceId: string }>;
            };
            return body.items.some(item => item.datasourceId === emptyDs);
          },
          { timeout: 20000 },
        )
        .toBe(true);
    } finally {
      await page.request
        .delete(
          `${backendUrl}/api/catalog-datastore/webhooks/tokens/${token.id}`,
        )
        .catch(() => {});
    }
  });

  test('a registered webhook receives a delivery after a changed run', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const runId = `${TEST_RUN_ID}-wh-${testInfo.project.name}`;

    const fixture = await createWorkflowShell(
      page,
      `E2E SideFx WH Fixture ${runId}`,
    );
    await setFixtureItems(page, fixture, [{ name: 'hook-object' }]);
    const ds = await createRunnableDataSource(
      page,
      `E2E SideFx WH DS ${runId}`,
      fixture,
    );

    // A local receiver: subscriptions are global, so record everything and
    // filter for our datasource.
    const received: Array<{ metadata?: { datasourceId?: string } }> = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          // Ignore non-JSON bodies.
        }
        res.writeHead(200).end();
      });
    });
    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const port = (server.address() as AddressInfo).port;

    const tokenRes = await page.request.post(
      `${backendUrl}/api/catalog-datastore/webhooks/tokens`,
      { data: { label: `e2e-webhook-${runId}` } },
    );
    expect(tokenRes.ok()).toBe(true);
    const token = (await tokenRes.json()) as { id: string; token: string };
    let subscriptionId: string | undefined;
    try {
      const subRes = await page.request.post(
        `${backendUrl}/api/webhooks/subscriptions`,
        {
          headers: { authorization: `Bearer ${token.token}` },
          data: {
            url: `http://127.0.0.1:${port}/hook`,
            secret: `e2e-secret-${runId}`,
            filters: {},
          },
        },
      );
      expect(subRes.ok()).toBe(true);
      subscriptionId = (await subRes.json()).subscriptionId;

      await execute(page, ds);

      // Delivery is debounced ~2s after the publish's changed event.
      await expect
        .poll(
          () => received.some(payload => payload.metadata?.datasourceId === ds),
          { timeout: 30000 },
        )
        .toBe(true);
    } finally {
      if (subscriptionId) {
        await page.request
          .delete(
            `${backendUrl}/api/catalog-datastore/webhooks/subscriptions/${subscriptionId}`,
          )
          .catch(() => {});
      }
      await page.request
        .delete(
          `${backendUrl}/api/catalog-datastore/webhooks/tokens/${token.id}`,
        )
        .catch(() => {});
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
