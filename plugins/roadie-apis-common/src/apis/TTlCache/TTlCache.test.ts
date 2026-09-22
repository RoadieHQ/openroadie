import { vi } from 'vitest';

import { TTlCache } from './index';

describe('TTlCache', () => {
  vi.useFakeTimers();

  it('should compute and cache the result of a function', async () => {
    const cache = new TTlCache<number>(1000);
    const computeFunction = vi.fn(async () => 42);

    const result1 = await cache.get('key1', computeFunction);
    const result2 = await cache.get('key1', computeFunction);

    expect(result1).toBe(42);
    expect(result2).toBe(42);
    expect(computeFunction).toHaveBeenCalledTimes(1);
  });

  it('should remove cached entry after TTL expires', async () => {
    const cache = new TTlCache<number>(1000);
    const computeFunction = vi.fn(async () => 42);

    const result1 = await cache.get('key1', computeFunction);

    vi.advanceTimersByTime(1000);

    const result2 = await cache.get('key1', computeFunction);

    expect(result1).toBe(42);
    expect(result2).toBe(42);
    expect(computeFunction).toHaveBeenCalledTimes(2);
  });

  it('should handle concurrent calls for the same key gracefully', async () => {
    const cache = new TTlCache<number>(6000);
    const computeFunction = vi.fn(async () => {
      return 42;
    });

    const [result1, result2] = await Promise.all([
      cache.get('key1', computeFunction),
      cache.get('key1', computeFunction),
    ]);

    expect(result1).toBe(42);
    expect(result2).toBe(42);
    expect(computeFunction).toHaveBeenCalledTimes(1);
  }, 10000);

  it('should cache multiple keys independently', async () => {
    const cache = new TTlCache<number>(1000);
    const computeFunction1 = vi.fn(async () => 42);
    const computeFunction2 = vi.fn(async () => 24);

    const result1 = await cache.get('key1', computeFunction1);
    const result2 = await cache.get('key2', computeFunction2);

    expect(result1).toBe(42);
    expect(result2).toBe(24);
    expect(computeFunction1).toHaveBeenCalledTimes(1);
    expect(computeFunction2).toHaveBeenCalledTimes(1);
  });

  it('if the first promise fails, it should not cache the value', async () => {
    const cache = new TTlCache<number>();
    const computeFunction1 = vi.fn(async () => {
      throw new Error(`faily fail fail`);
    });
    const computeFunction2 = vi.fn(async () => 42);

    await expect(cache.get('key1', computeFunction1)).rejects.toEqual(
      new Error('faily fail fail'),
    );
    const result2 = await cache.get('key1', computeFunction2);

    expect(result2).toBe(42);
  });

  it('should handle concurrent calls with different TTLs correctly', async () => {
    const cache = new TTlCache<number>(2000);
    const computeFunction = vi.fn(async ({ setTtl }) => {
      setTtl(5000);
      return 42;
    });

    const computeFunction2 = vi.fn(async () => 24);

    const [result1, result2] = await Promise.all([
      cache.get('key1', computeFunction),
      cache.get('key2', computeFunction2),
    ]);

    expect(result1).toBe(42);
    expect(result2).toBe(24);
    expect(computeFunction).toHaveBeenCalledTimes(1);
    expect(computeFunction2).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000); // Advance 3 seconds (key1 should still be cached due to custom TTL)

    const result3 = await cache.get('key1', computeFunction);

    expect(result3).toBe(42);
    expect(computeFunction).toHaveBeenCalledTimes(1); // Still cached due to custom TTL
  });

  it('should use default TTL if setTtl is not called', async () => {
    const cache = new TTlCache<number>(3000);
    const computeFunction = vi.fn(async () => 42);

    const result1 = await cache.get('key1', computeFunction);

    vi.advanceTimersByTime(2000);

    const result2 = await cache.get('key1', computeFunction);

    expect(result1).toBe(42);
    expect(result2).toBe(42);
    expect(computeFunction).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);

    const result3 = await cache.get('key1', computeFunction);

    expect(result3).toBe(42);
    expect(computeFunction).toHaveBeenCalledTimes(2);
  });

  it('should respect a custom TTL set through context', async () => {
    const cache = new TTlCache<number>(2000);
    const computeFunction = vi.fn(async ({ setTtl }) => {
      setTtl(5000);
      return 42;
    });

    const result1 = await cache.get('key1', computeFunction);

    vi.advanceTimersByTime(3000);

    const result2 = await cache.get('key1', computeFunction);

    expect(result1).toBe(42);
    expect(result2).toBe(42);
    expect(computeFunction).toHaveBeenCalledTimes(1); // Cached due to custom TTL

    vi.advanceTimersByTime(2000);

    const result3 = await cache.get('key1', computeFunction);

    expect(result3).toBe(42);
    expect(computeFunction).toHaveBeenCalledTimes(2);
  });
});
