import React from 'react';
import { createMemoryRouter } from 'react-router';
import {
  ROUTER_PERFORMANCE_ENTRIES,
  createRouterPerformanceInstrumentation,
  type RouterPerformance,
} from './navigation-performance';

function createPerformanceRecorder() {
  let time = 0;
  const measure =
    vi.fn<
      (name: string, options: PerformanceMeasureOptions) => PerformanceMeasure
    >();
  const performanceApi: RouterPerformance = {
    now: () => {
      time += 10;
      return time;
    },
    measure,
  };

  return { measure, performanceApi };
}

describe('router performance instrumentation', () => {
  it('measures navigations by matched route pattern without recording parameter values', async () => {
    const { measure, performanceApi } = createPerformanceRecorder();
    const router = createMemoryRouter(
      [
        { path: '/', element: <div>Home</div> },
        {
          path: '/projects/:projectId',
          element: <div>Project</div>,
        },
      ],
      {
        initialEntries: ['/'],
        instrumentations: [
          createRouterPerformanceInstrumentation(performanceApi),
        ],
      },
    );

    await router.navigate('/projects/project-secret-123');

    expect(measure).toHaveBeenCalledWith(
      ROUTER_PERFORMANCE_ENTRIES.navigation,
      expect.objectContaining({
        start: 10,
        end: 20,
        detail: {
          pattern: '/projects/:projectId',
          method: 'GET',
          status: 'success',
          errorName: undefined,
        },
      }),
    );
    expect(JSON.stringify(measure.mock.calls)).not.toContain(
      'project-secret-123',
    );
  });

  it('measures lazy route loading separately from the completed navigation', async () => {
    const { measure, performanceApi } = createPerformanceRecorder();
    const router = createMemoryRouter(
      [
        { path: '/', element: <div>Home</div> },
        {
          id: 'settings',
          path: '/settings',
          lazy: async () => ({ Component: () => <div>Settings</div> }),
        },
      ],
      {
        initialEntries: ['/'],
        instrumentations: [
          createRouterPerformanceInstrumentation(performanceApi),
        ],
      },
    );

    await router.navigate('/settings');

    expect(measure).toHaveBeenCalledWith(
      ROUTER_PERFORMANCE_ENTRIES.lazy,
      expect.objectContaining({
        detail: {
          routeId: 'settings',
          routePath: '/settings',
          status: 'success',
          errorName: undefined,
        },
      }),
    );
    expect(measure).toHaveBeenCalledWith(
      ROUTER_PERFORMANCE_ENTRIES.navigation,
      expect.objectContaining({
        detail: expect.objectContaining({
          pattern: '/settings',
          status: 'success',
        }),
      }),
    );
  });

  it('normalizes mutation methods for stable analytics dimensions', async () => {
    const { measure, performanceApi } = createPerformanceRecorder();
    const router = createMemoryRouter(
      [
        { path: '/', element: <div>Home</div> },
        {
          path: '/actions',
          action: async () => null,
          element: <div>Actions</div>,
        },
      ],
      {
        initialEntries: ['/'],
        instrumentations: [
          createRouterPerformanceInstrumentation(performanceApi),
        ],
      },
    );

    await router.navigate('/actions', {
      formMethod: 'post',
      formData: new FormData(),
    });

    expect(measure).toHaveBeenCalledWith(
      ROUTER_PERFORMANCE_ENTRIES.navigation,
      expect.objectContaining({
        detail: expect.objectContaining({
          method: 'POST',
          pattern: '/actions',
        }),
      }),
    );
  });
});
