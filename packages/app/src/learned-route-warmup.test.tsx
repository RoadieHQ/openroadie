import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_ROUTES_STORAGE_KEY,
  readRecentRoutes,
  recordRecentRoute,
  warmLearnedRoutes,
} from './learned-route-warmup';

afterEach(() => {
  window.localStorage.clear();
});

describe('recent routes', () => {
  it('keeps an allow-listed most-recently-used route list', () => {
    recordRecentRoute('/actions');
    recordRecentRoute('/capabilities');
    recordRecentRoute('/actions');
    recordRecentRoute('/actions/action-1');

    expect(readRecentRoutes()).toEqual(['/actions', '/capabilities']);
  });

  it('ignores invalid stored values', () => {
    window.localStorage.setItem(
      RECENT_ROUTES_STORAGE_KEY,
      JSON.stringify(['/actions/action-1']),
    );

    expect(readRecentRoutes()).toEqual([]);
  });
});

describe('warmLearnedRoutes', () => {
  it('prefetches the two most recent route matches', async () => {
    const router = createMemoryRouter([
      {
        id: 'root',
        path: '/',
        children: [
          { id: 'actions', path: 'actions', loader: () => null },
          { id: 'capabilities', path: 'capabilities', loader: () => null },
          { id: 'integrations', path: 'integrations', loader: () => null },
        ],
      },
    ]);
    const fetch = vi.spyOn(router, 'fetch').mockResolvedValue();
    const deleteFetcher = vi.spyOn(router, 'deleteFetcher');

    await warmLearnedRoutes(router, [
      '/actions',
      '/capabilities',
      '/integrations',
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'learned-route:/actions',
      'root',
      '/actions',
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'learned-route:/capabilities',
      'root',
      '/capabilities',
    );
    expect(deleteFetcher).toHaveBeenCalledTimes(2);
  });

  it('targets the content route for an index screen', async () => {
    const router = createMemoryRouter([
      {
        id: 'root',
        path: '/',
        children: [
          {
            id: 'context-groups',
            path: 'context-groups',
            children: [
              {
                id: 'context-groups-overview',
                index: true,
                loader: () => null,
              },
            ],
          },
        ],
      },
    ]);
    const fetch = vi.spyOn(router, 'fetch').mockResolvedValue();

    await warmLearnedRoutes(router, ['/context-groups']);

    expect(fetch).toHaveBeenCalledWith(
      'learned-route:/context-groups',
      'root',
      '/context-groups?index=',
    );
  });

  it('skips destinations with no loader or lazy route to fetch', async () => {
    const router = createMemoryRouter([
      {
        id: 'root',
        path: '/',
        children: [{ id: 'secrets', path: 'secrets', element: null }],
      },
    ]);
    const fetch = vi.spyOn(router, 'fetch').mockResolvedValue();

    await warmLearnedRoutes(router, ['/secrets']);

    expect(fetch).not.toHaveBeenCalled();
  });
});
