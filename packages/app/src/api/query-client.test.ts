import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from './query-client';

afterEach(() => {
  vi.useRealTimers();
});

describe('createQueryClient', () => {
  it.each([
    ['off', 5 * 60_000],
    ['primary', 30 * 60_000],
    ['full', Infinity],
  ] as const)('uses %s retention for the device tier', (tier, gcTime) => {
    expect(createQueryClient(tier).getDefaultOptions().queries).toMatchObject({
      staleTime: 30_000,
      gcTime,
      refetchOnWindowFocus: false,
      retry: 1,
    });
  });

  it('evicts a large inactive cache on constrained devices', async () => {
    vi.useFakeTimers();
    const client = createQueryClient('off');

    for (let index = 0; index < 1_000; index += 1) {
      client.setQueryData(['object', index], { id: index });
    }

    expect(client.getQueryCache().getAll()).toHaveLength(1_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
