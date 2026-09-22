import { randomUUID } from 'node:crypto';
import type {
  APIRequestContext,
  APIResponse,
  Page,
  TestInfo,
} from '@playwright/test';
import { test, expect } from './fixtures';
import { resolveBackendUrl } from './backend';

const TEST_RUN_ID = Date.now().toString(36);

interface CreatedResource {
  id: string;
  name: string;
}

interface WorkflowListResponse {
  data: CreatedResource[];
}

interface DataSourceSeed {
  name: string;
  integrationSlug: string;
  created: boolean;
}

declare global {
  interface Window {
    closeEntityChangeStream?: () => void;
  }
}

async function assertOk(response: APIResponse, operation: string) {
  if (!response.ok()) {
    throw new Error(
      `${operation} failed with ${response.status()}: ${await response.text()}`,
    );
  }
}

async function createAction(
  request: APIRequestContext,
  backendUrl: string,
  name: string,
  slug: string,
): Promise<CreatedResource> {
  const response = await request.post(`${backendUrl}/api/actions`, {
    data: {
      name,
      slug,
      description: 'Live refresh E2E action',
      parameters: [],
      steps: [
        {
          id: 'request',
          integrationId: randomUUID(),
          request: {
            method: 'GET',
            path: '/',
            headers: [],
            body: '',
          },
        },
      ],
      enabled: true,
    },
  });
  await assertOk(response, 'Create action');
  return response.json();
}

async function createCapability(
  request: APIRequestContext,
  backendUrl: string,
  name: string,
  slug: string,
): Promise<CreatedResource> {
  const response = await request.post(`${backendUrl}/api/capabilities`, {
    data: {
      name,
      slug,
      description: 'Live refresh E2E capability',
      instructions: 'Respond with the current capability state.',
    },
  });
  await assertOk(response, 'Create capability');
  return response.json();
}

async function createDataSource(
  request: APIRequestContext,
  backendUrl: string,
  name: string,
): Promise<CreatedResource> {
  const response = await request.post(
    `${backendUrl}/api/catalog-workflow/workflows`,
    {
      data: {
        name,
        description: 'Live refresh E2E data source',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: false,
      },
    },
  );
  await assertOk(response, 'Create data source');
  const body: { data: CreatedResource } = await response.json();
  return body.data;
}

async function deleteBestEffort(request: APIRequestContext, url: string) {
  await request.delete(url).catch(() => {});
}

async function waitForEntity(page: Page, name: string, visible: boolean) {
  const entity = page.getByText(name, { exact: true });
  if (visible) {
    await expect(entity).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(entity).toHaveCount(0, { timeout: 15_000 });
  }
}

function runId(testInfo: TestInfo, label: string) {
  return `${label}-${TEST_RUN_ID}-${testInfo.parallelIndex}`;
}

test.describe('Live entity refresh', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'SSE and query invalidation are covered once in Chromium',
  );

  test('keeps the Actions screen current across external writes', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'actions');
    const baseline = await createAction(
      request,
      backendUrl,
      `E2E Live Actions Baseline ${id}`,
      `e2e-live-actions-baseline-${id}`,
    );
    let target: CreatedResource | undefined;

    try {
      await page.goto('/actions');
      await waitForEntity(page, baseline.name, true);

      const search = page.getByRole('searchbox', { name: 'Search actions' });
      const initialName = `E2E Live Action ${id}`;
      const updatedName = `${initialName} Updated`;
      await search.fill(initialName);

      target = await createAction(
        request,
        backendUrl,
        initialName,
        `e2e-live-action-${id}`,
      );
      await waitForEntity(page, initialName, true);

      const update = await request.patch(
        `${backendUrl}/api/actions/${target.id}`,
        { data: { name: updatedName } },
      );
      await assertOk(update, 'Update action');
      await search.fill(updatedName);
      await waitForEntity(page, updatedName, true);

      const remove = await request.delete(
        `${backendUrl}/api/actions/${target.id}`,
      );
      await assertOk(remove, 'Delete action');
      await waitForEntity(page, updatedName, false);
      target = undefined;
    } finally {
      await deleteBestEffort(
        request,
        `${backendUrl}/api/actions/${baseline.id}`,
      );
      if (target) {
        await deleteBestEffort(
          request,
          `${backendUrl}/api/actions/${target.id}`,
        );
      }
    }
  });

  test('keeps the Capabilities screen current across external writes', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'capabilities');
    const baseline = await createCapability(
      request,
      backendUrl,
      `E2E Live Capabilities Baseline ${id}`,
      `e2e-live-capabilities-baseline-${id}`,
    );
    let target: CreatedResource | undefined;

    try {
      await page.goto('/capabilities');
      await waitForEntity(page, baseline.name, true);

      const search = page.getByRole('searchbox', {
        name: 'Search capabilities by name',
      });
      const initialName = `E2E Live Capability ${id}`;
      const updatedName = `${initialName} Updated`;
      await search.fill(initialName);

      target = await createCapability(
        request,
        backendUrl,
        initialName,
        `e2e-live-capability-${id}`,
      );
      await waitForEntity(page, initialName, true);

      const update = await request.patch(
        `${backendUrl}/api/capabilities/${target.id}`,
        { data: { name: updatedName } },
      );
      await assertOk(update, 'Update capability');
      await search.fill(updatedName);
      await waitForEntity(page, updatedName, true);

      const remove = await request.delete(
        `${backendUrl}/api/capabilities/${target.id}`,
      );
      await assertOk(remove, 'Delete capability');
      await waitForEntity(page, updatedName, false);
      target = undefined;
    } finally {
      await deleteBestEffort(
        request,
        `${backendUrl}/api/capabilities/${baseline.id}`,
      );
      if (target) {
        await deleteBestEffort(
          request,
          `${backendUrl}/api/capabilities/${target.id}`,
        );
      }
    }
  });

  test('keeps the Data Sources screen current across external writes', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'data-sources');
    const baseline = await createDataSource(
      request,
      backendUrl,
      `E2E Live Data Sources Baseline ${id}`,
    );
    let target: CreatedResource | undefined;

    try {
      await page.goto('/data-sources');
      await waitForEntity(page, baseline.name, true);

      const search = page.getByRole('searchbox', {
        name: /filter by name, description, or integration/i,
      });
      const initialName = `E2E Live Data Source ${id}`;
      const updatedName = `${initialName} Updated`;
      await search.fill(initialName);

      target = await createDataSource(request, backendUrl, initialName);
      await waitForEntity(page, initialName, true);

      const update = await request.patch(
        `${backendUrl}/api/catalog-workflow/workflows/${target.id}`,
        { data: { name: updatedName } },
      );
      await assertOk(update, 'Update data source');
      await search.fill(updatedName);
      await waitForEntity(page, updatedName, true);

      const remove = await request.delete(
        `${backendUrl}/api/catalog-workflow/workflows/${target.id}`,
      );
      await assertOk(remove, 'Delete data source');
      await waitForEntity(page, updatedName, false);
      target = undefined;
    } finally {
      await deleteBestEffort(
        request,
        `${backendUrl}/api/catalog-workflow/workflows/${baseline.id}`,
      );
      if (target) {
        await deleteBestEffort(
          request,
          `${backendUrl}/api/catalog-workflow/workflows/${target.id}`,
        );
      }
    }
  });

  test('shows a data source created by seed application without reloading', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'seed');
    const baseline = await createDataSource(
      request,
      backendUrl,
      `E2E Live Seed Baseline ${id}`,
    );
    let seededWorkflow: CreatedResource | undefined;

    try {
      const [seedsResponse, integrationsResponse] = await Promise.all([
        request.get(`${backendUrl}/api/catalog-workflow/data-source-seeds`),
        request.get(`${backendUrl}/api/integrations/?limit=1000`),
      ]);
      await assertOk(seedsResponse, 'List data source seeds');
      await assertOk(integrationsResponse, 'List integrations');
      const seedsBody: { data: DataSourceSeed[] } = await seedsResponse.json();
      const integrationsBody: { data: Array<{ slug: string }> } =
        await integrationsResponse.json();
      const integrationSlugs = new Set(
        integrationsBody.data.map(integration => integration.slug),
      );
      const seed = seedsBody.data.find(
        candidate =>
          !candidate.created && integrationSlugs.has(candidate.integrationSlug),
      );
      if (!seed) {
        throw new Error(
          'No uncreated data source seed with a matching integration is available',
        );
      }

      await page.goto('/data-sources');
      await waitForEntity(page, baseline.name, true);
      const search = page.getByRole('searchbox', {
        name: /filter by name, description, or integration/i,
      });
      await search.fill(seed.name);

      const apply = await request.post(
        `${backendUrl}/api/catalog-workflow/data-source-seeds/apply`,
        { data: { seeds: [seed.name] } },
      );
      await assertOk(apply, 'Apply data source seed');
      await waitForEntity(page, seed.name, true);

      const workflowsResponse = await request.get(
        `${backendUrl}/api/catalog-workflow/workflows?workflowType=data-ingestion&limit=1000`,
      );
      await assertOk(workflowsResponse, 'List seeded data sources');
      const workflows: WorkflowListResponse = await workflowsResponse.json();
      seededWorkflow = workflows.data.find(
        workflow => workflow.name === seed.name,
      );
      if (!seededWorkflow) {
        throw new Error(`Seeded workflow "${seed.name}" was not persisted`);
      }
    } finally {
      await deleteBestEffort(
        request,
        `${backendUrl}/api/catalog-workflow/workflows/${baseline.id}`,
      );
      if (seededWorkflow) {
        await deleteBestEffort(
          request,
          `${backendUrl}/api/catalog-workflow/workflows/${seededWorkflow.id}`,
        );
      }
    }
  });

  test('reconciles missed changes after the browser stream reconnects', async ({
    page,
    request,
  }, testInfo) => {
    const backendUrl = await resolveBackendUrl(request);
    const id = runId(testInfo, 'reconnect');
    const baseline = await createAction(
      request,
      backendUrl,
      `E2E Live Reconnect Baseline ${id}`,
      `e2e-live-reconnect-baseline-${id}`,
    );
    let target: CreatedResource | undefined;

    try {
      await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        let closeCurrentStream: (() => void) | undefined;

        window.closeEntityChangeStream = () => closeCurrentStream?.();
        window.fetch = async (...args) => {
          const response = await originalFetch(...args);
          const input = args[0];
          const url =
            input instanceof Request
              ? input.url
              : new URL(String(input), window.location.href).href;
          if (
            !url.endsWith('/api/entity-change-stream/stream') ||
            !response.body
          ) {
            return response;
          }

          const reader = response.body.getReader();
          let closed = false;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              closeCurrentStream = () => {
                if (closed) {
                  return;
                }
                closed = true;
                void reader.cancel();
                controller.close();
              };
            },
            async pull(controller) {
              try {
                const result = await reader.read();
                if (closed) {
                  return;
                }
                if (result.done) {
                  closed = true;
                  controller.close();
                } else {
                  controller.enqueue(result.value);
                }
              } catch (error) {
                if (!closed) {
                  controller.error(error);
                }
              }
            },
            cancel() {
              closed = true;
              return reader.cancel();
            },
          });

          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        };
      });

      const initialStream = page.waitForResponse(
        response =>
          response.url().endsWith('/api/entity-change-stream/stream') &&
          response.ok(),
      );
      await page.goto('/actions');
      await initialStream;
      await waitForEntity(page, baseline.name, true);

      const targetName = `E2E Live Reconnect ${id}`;
      await page
        .getByRole('searchbox', { name: 'Search actions' })
        .fill(targetName);

      await page.evaluate(() => window.closeEntityChangeStream?.());

      const reconnectedStream = page.waitForResponse(
        response =>
          response.url().endsWith('/api/entity-change-stream/stream') &&
          response.ok(),
        { timeout: 15_000 },
      );
      target = await createAction(
        request,
        backendUrl,
        targetName,
        `e2e-live-reconnect-${id}`,
      );

      await reconnectedStream;
      await waitForEntity(page, targetName, true);
    } finally {
      await deleteBestEffort(
        request,
        `${backendUrl}/api/actions/${baseline.id}`,
      );
      if (target) {
        await deleteBestEffort(
          request,
          `${backendUrl}/api/actions/${target.id}`,
        );
      }
    }
  });
});
