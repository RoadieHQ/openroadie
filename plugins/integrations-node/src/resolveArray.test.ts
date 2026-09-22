import { describe, expect, it, vi } from 'vitest';

import { findAllArraysInObject, detectArrayInResponse } from './resolveArray';

describe('findAllArraysInObject', () => {
  it('finds single array at top level', () => {
    const obj = { items: [1, 2, 3] };
    const result = findAllArraysInObject(obj);

    expect(result).toHaveLength(1);
    expect(result[0].path).toEqual(['items']);
    expect(result[0].array).toEqual([1, 2, 3]);
  });

  it('finds multiple arrays at different levels', () => {
    const obj = {
      items: [1, 2],
      data: {
        results: [3, 4, 5],
      },
    };
    const result = findAllArraysInObject(obj);

    expect(result).toHaveLength(2);
    expect(result[0].path).toEqual(['items']);
    expect(result[1].path).toEqual(['data', 'results']);
  });

  it('finds nested arrays', () => {
    const obj = {
      level1: {
        level2: {
          items: ['a', 'b'],
        },
      },
    };
    const result = findAllArraysInObject(obj);

    expect(result).toHaveLength(1);
    expect(result[0].path).toEqual(['level1', 'level2', 'items']);
  });

  it('respects maxDepth limit', () => {
    const obj = {
      level1: {
        level2: {
          level3: {
            level4: {
              items: [1, 2],
            },
          },
        },
      },
    };
    const result = findAllArraysInObject(obj, [], 3);

    expect(result).toHaveLength(0);
  });

  it('returns array itself when given array', () => {
    const arr = [1, 2, 3];
    const result = findAllArraysInObject(arr);

    expect(result).toHaveLength(1);
    expect(result[0].path).toEqual([]);
    expect(result[0].array).toEqual([1, 2, 3]);
  });

  it('returns empty array for objects with no arrays', () => {
    const obj = { name: 'test', value: 123 };
    const result = findAllArraysInObject(obj);

    expect(result).toHaveLength(0);
  });

  it('handles empty objects', () => {
    const obj = {};
    const result = findAllArraysInObject(obj);

    expect(result).toHaveLength(0);
  });

  it('handles null values', () => {
    const obj = { items: null, data: [1, 2] };
    const result = findAllArraysInObject(obj);

    expect(result).toHaveLength(1);
    expect(result[0].path).toEqual(['data']);
  });
});

describe('detectArrayInResponse', () => {
  it.each([
    ['items', [{ id: 1 }, { id: 2 }], { next_page_token: 'abc' }],
    ['data', [{ name: 'foo' }, { name: 'bar' }], {}],
    ['results', [1, 2, 3], { metadata: { count: 3 } }],
  ])('detects "%s" key using heuristic', async (key, array, extras) => {
    const obj = { [`${key}`]: array, ...extras };
    const log = vi.fn();

    const result = await detectArrayInResponse(obj, log);

    expect(result).toEqual(array);
    expect(log).toHaveBeenCalledWith(
      `Auto-detected array at key "${key}" in response`,
    );
  });

  it('tries all common keys in order', async () => {
    const obj = {
      entries: ['a', 'b'],
      items: ['c', 'd'],
    };
    const log = vi.fn();

    const result = await detectArrayInResponse(obj, log);

    expect(result).toEqual(['c', 'd']);
    expect(log).toHaveBeenCalledWith(
      'Auto-detected array at key "items" in response',
    );
  });

  it('falls back to single array detection when no common key found', async () => {
    const obj = {
      customArrayKey: [{ x: 1 }, { x: 2 }],
    };
    const log = vi.fn();

    const result = await detectArrayInResponse(obj, log);

    expect(result).toEqual([{ x: 1 }, { x: 2 }]);
    expect(log).toHaveBeenCalledWith(
      'Auto-detected single array at path "customArrayKey" in response',
    );
  });

  it('detects largest array when multiple found', async () => {
    const obj = {
      small: [1],
      large: [1, 2, 3, 4, 5],
      medium: [1, 2, 3],
    };
    const log = vi.fn();

    const result = await detectArrayInResponse(obj, log);

    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(log).toHaveBeenCalledWith(
      'Auto-detected largest array at path "large" (5 items) in response',
    );
  });

  it('returns null when no arrays found', async () => {
    const obj = {
      name: 'test',
      value: 123,
    };
    const log = vi.fn();

    const result = await detectArrayInResponse(obj, log);

    expect(result).toBeNull();
  });

  it('returns null when only empty arrays found', async () => {
    const obj = {
      empty1: [],
      empty2: [],
    };
    const log = vi.fn();

    const result = await detectArrayInResponse(obj, log);

    expect(result).toBeNull();
  });
});
