import { describe, expect, it, vi } from 'vitest';
import { createRouteModuleWarmup } from './route-module-warmup';

describe('createRouteModuleWarmup', () => {
  it('loads every registered route once', async () => {
    const warmup = createRouteModuleWarmup();
    const first = vi.fn().mockResolvedValue('first');
    const second = vi.fn().mockResolvedValue('second');
    const loadFirst = warmup.register(first);
    warmup.register(second);

    await warmup.warm();
    await loadFirst();

    expect(warmup.size()).toBe(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('retries a route that failed during idle warming', async () => {
    const warmup = createRouteModuleWarmup();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('ready');
    const loadRoute = warmup.register(load);

    await warmup.warm();

    await expect(loadRoute()).resolves.toBe('ready');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
