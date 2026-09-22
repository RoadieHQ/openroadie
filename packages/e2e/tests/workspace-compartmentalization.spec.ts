import type { APIRequestContext } from '@playwright/test';
import { resolveBackendUrl } from './backend';
import { expect, test } from './fixtures';

const WORKSPACE_HEADER = 'x-openroadie-workspace-id';

type Workspace = {
  id: string;
};

type Capability = {
  id: string;
};

test('keeps capability lists and counts inside the selected workspace', async ({
  page,
  navigateTo,
}, testInfo) => {
  const backendUrl = await resolveBackendUrl(page.request);
  const runId = `${Date.now().toString(36)}-${testInfo.project.name}`;
  const request: APIRequestContext = page.request;
  const cleanup: Array<() => Promise<void>> = [];

  async function createWorkspace(name: string, suffix: string) {
    const response = await request.post(`${backendUrl}/api/workspaces`, {
      data: {
        name,
        slug: `e2e-${suffix}-${runId}`.toLowerCase(),
        type: 'organization',
      },
    });
    expect(response.ok()).toBe(true);
    const workspace: Workspace = await response.json();
    cleanup.push(async () => {
      await request
        .delete(`${backendUrl}/api/workspaces/${workspace.id}`)
        .catch(() => {});
    });
    return workspace;
  }

  async function createCapability(
    workspace: Workspace,
    name: string,
    suffix: string,
  ) {
    const response = await request.post(`${backendUrl}/api/capabilities`, {
      headers: { [WORKSPACE_HEADER]: workspace.id },
      data: {
        name,
        slug: `e2e-${suffix}-${runId}`.toLowerCase(),
        description: 'Workspace isolation proof',
        instructions: 'Workspace isolation proof',
      },
    });
    expect(response.ok()).toBe(true);
    const capability: Capability = await response.json();
    cleanup.push(async () => {
      await request
        .delete(`${backendUrl}/api/capabilities/${capability.id}`, {
          headers: { [WORKSPACE_HEADER]: workspace.id },
        })
        .catch(() => {});
    });
  }

  const alphaName = `Alpha ${runId}`;
  const betaName = `Beta ${runId}`;
  const alphaFirst = `Alpha first ${runId}`;
  const alphaSecond = `Alpha second ${runId}`;
  const betaOnly = `Beta only ${runId}`;

  try {
    const alpha = await createWorkspace(alphaName, 'alpha');
    const beta = await createWorkspace(betaName, 'beta');
    await createCapability(alpha, alphaFirst, 'alpha-first');
    await createCapability(alpha, alphaSecond, 'alpha-second');
    await createCapability(beta, betaOnly, 'beta-only');

    await navigateTo(`/capabilities?workspace=${alpha.id}`);

    const capabilitiesLink = page.getByRole('link', {
      name: 'Capabilities',
      exact: true,
    });
    await expect(page.getByText(alphaFirst, { exact: true })).toBeVisible();
    await expect(page.getByText(alphaSecond, { exact: true })).toBeVisible();
    await expect(page.getByText(betaOnly, { exact: true })).toHaveCount(0);
    await expect(capabilitiesLink).toHaveAccessibleDescription('2');

    await page.getByRole('button', { name: `Workspace: ${alphaName}` }).click();
    await page.getByRole('menuitem', { name: betaName }).click();
    await expect(page).toHaveURL(
      new RegExp(`/datastore\\?workspace=${beta.id}$`),
    );
    await expect(
      page.getByRole('button', { name: `Workspace: ${betaName}` }),
    ).toBeVisible();

    await capabilitiesLink.click();
    await expect(page).toHaveURL(/\/capabilities(?:\?.*)?$/);
    await expect(capabilitiesLink).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(betaOnly, { exact: true })).toBeVisible();
    await expect(page.getByText(alphaFirst, { exact: true })).toHaveCount(0);
    await expect(page.getByText(alphaSecond, { exact: true })).toHaveCount(0);
    await expect(capabilitiesLink).toHaveAccessibleDescription('1');

    await page.reload();
    await expect(
      page.getByRole('button', { name: `Workspace: ${betaName}` }),
    ).toBeVisible();
    await expect(page.getByText(betaOnly, { exact: true })).toBeVisible();
    await expect(capabilitiesLink).toHaveAccessibleDescription('1');
  } finally {
    for (const remove of cleanup.reverse()) {
      await remove();
    }
  }
});
