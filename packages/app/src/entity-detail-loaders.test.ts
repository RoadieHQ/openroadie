import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { LoaderFunctionArgs } from 'react-router';
import type { ActionWithSchema, Capability } from './api';
import { createApis } from './api';
import { queryKeys } from './api/queries';
import { workspaceQueryKeyInScope } from './api/workspace-scope';
import {
  actionDetailLoader,
  capabilityDetailLoader,
} from './entity-detail-loaders';
import {
  createAppRouteContext,
  workspaceScopeKeyRouteContext,
} from './route-context';

const action: ActionWithSchema = {
  id: 'action-1',
  name: 'Create issue',
  slug: 'create-issue',
  description: 'Creates an issue',
  parameters: [],
  steps: [],
  enabled: true,
  currentVersion: 1,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
};

const capability: Capability = {
  id: 'capability-1',
  name: 'Triage issue',
  slug: 'triage-issue',
  description: 'Triages an issue',
  instructions: 'Triage the issue',
  currentVersion: 1,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
};

function createTestDependencies() {
  const apis = createApis({
    app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
    backend: { baseUrl: 'http://localhost' },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const context = createAppRouteContext({ apis, queryClient });
  return { apis, context, queryClient };
}

/**
 * A complete `LoaderFunctionArgs` for a loader under test.
 *
 * React Router's args carry more than the loaders here read (`url` and
 * `pattern` alongside the request), so building them by hand at each call site
 * means every future addition to that type breaks eight places.
 */
function loaderArgs(
  url: string,
  params: Record<string, string>,
  context: ReturnType<typeof createAppRouteContext>,
): LoaderFunctionArgs<Readonly<ReturnType<typeof createAppRouteContext>>> {
  return {
    request: new Request(url),
    params,
    context,
    url: new URL(url),
    pattern: '',
  };
}

describe('actionDetailLoader', () => {
  it('loads the action into the shared query cache', async () => {
    const { apis, context, queryClient } = createTestDependencies();
    vi.spyOn(apis.actions, 'get').mockResolvedValue(action);

    await expect(
      actionDetailLoader(
        loaderArgs(
          'http://localhost/actions/action-1',
          { actionId: 'action-1' },
          context,
        ),
      ),
    ).resolves.toBe(action);
    expect(queryClient.getQueryData(queryKeys.actionDetail('action-1'))).toBe(
      action,
    );
  });

  it('does not request a cached action again', async () => {
    const { apis, context, queryClient } = createTestDependencies();
    const getAction = vi.spyOn(apis.actions, 'get');
    queryClient.setQueryData(queryKeys.actionDetail('action-1'), action);

    await actionDetailLoader(
      loaderArgs(
        'http://localhost/actions/action-1',
        { actionId: 'action-1' },
        context,
      ),
    );

    expect(getAction).not.toHaveBeenCalled();
  });

  it('stores a destination workspace response in its own cache', async () => {
    const { apis, context, queryClient } = createTestDependencies();
    context.set(workspaceScopeKeyRouteContext, 'workspace-b');
    vi.spyOn(apis.actions, 'get').mockResolvedValue(action);

    await actionDetailLoader(
      loaderArgs(
        'http://localhost/actions/action-1?workspace=workspace-b',
        { actionId: 'action-1' },
        context,
      ),
    );

    expect(
      queryClient.getQueryData(
        workspaceQueryKeyInScope(
          queryKeys.actionDetail('action-1'),
          'workspace-b',
        ),
      ),
    ).toBe(action);
    expect(
      queryClient.getQueryData(queryKeys.actionDetail('action-1')),
    ).toBeUndefined();
  });

  it('routes a missing action to the scoped not-found boundary', async () => {
    const { apis, context } = createTestDependencies();
    vi.spyOn(apis.actions, 'get').mockResolvedValue(undefined);

    await expect(
      actionDetailLoader(
        loaderArgs(
          'http://localhost/actions/missing',
          { actionId: 'missing' },
          context,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('requests an action again after a cached miss', async () => {
    const { apis, context, queryClient } = createTestDependencies();
    queryClient.setQueryData(queryKeys.actionDetail('action-1'), null);
    const getAction = vi.spyOn(apis.actions, 'get').mockResolvedValue(action);

    await expect(
      actionDetailLoader(
        loaderArgs(
          'http://localhost/actions/action-1',
          { actionId: 'action-1' },
          context,
        ),
      ),
    ).resolves.toBe(action);
    expect(getAction).toHaveBeenCalledOnce();
  });
});

describe('capabilityDetailLoader', () => {
  it('loads the capability into the shared query cache', async () => {
    const { apis, context, queryClient } = createTestDependencies();
    vi.spyOn(apis.capabilities, 'get').mockResolvedValue(capability);

    await expect(
      capabilityDetailLoader(
        loaderArgs(
          'http://localhost/capabilities/capability-1',
          { capabilityId: 'capability-1' },
          context,
        ),
      ),
    ).resolves.toBe(capability);
    expect(
      queryClient.getQueryData(queryKeys.capabilityDetail('capability-1')),
    ).toBe(capability);
  });

  it('does not load the reserved new route', async () => {
    const { apis, context } = createTestDependencies();
    const getCapability = vi.spyOn(apis.capabilities, 'get');

    await expect(
      capabilityDetailLoader(
        loaderArgs(
          'http://localhost/capabilities/new',
          { capabilityId: 'new' },
          context,
        ),
      ),
    ).resolves.toBeNull();
    expect(getCapability).not.toHaveBeenCalled();
  });

  it('routes a missing capability to the scoped not-found boundary', async () => {
    const { apis, context } = createTestDependencies();
    vi.spyOn(apis.capabilities, 'get').mockResolvedValue(undefined);

    await expect(
      capabilityDetailLoader(
        loaderArgs(
          'http://localhost/capabilities/missing',
          { capabilityId: 'missing' },
          context,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('requests a capability again after a cached miss', async () => {
    const { apis, context, queryClient } = createTestDependencies();
    queryClient.setQueryData(queryKeys.capabilityDetail('capability-1'), null);
    const getCapability = vi
      .spyOn(apis.capabilities, 'get')
      .mockResolvedValue(capability);

    await expect(
      capabilityDetailLoader(
        loaderArgs(
          'http://localhost/capabilities/capability-1',
          { capabilityId: 'capability-1' },
          context,
        ),
      ),
    ).resolves.toBe(capability);
    expect(getCapability).toHaveBeenCalledOnce();
  });
});
