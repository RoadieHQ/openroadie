import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { createApis } from './api';
import {
  apiClientsRouteContext,
  createAppRouteContext,
  queryClientRouteContext,
} from './route-context';

describe('createAppRouteContext', () => {
  it('provides typed application dependencies to route data functions', () => {
    const apis = createApis({
      app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
      backend: { baseUrl: 'http://localhost' },
    });
    const queryClient = new QueryClient();
    const context = createAppRouteContext({ apis, queryClient });

    expect(context.get(apiClientsRouteContext)).toBe(apis);
    expect(context.get(queryClientRouteContext)).toBe(queryClient);
  });

  it('creates an isolated context for each navigation', () => {
    const apis = createApis({
      app: { title: 'OpenRoadie', baseUrl: 'http://localhost' },
      backend: { baseUrl: 'http://localhost' },
    });
    const queryClient = new QueryClient();

    expect(createAppRouteContext({ apis, queryClient })).not.toBe(
      createAppRouteContext({ apis, queryClient }),
    );
  });
});
