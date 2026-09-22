import { describe, expect, it } from 'vitest';
import jsonataSafe from '@roadiehq/jsonata-safe';
import { buildResults } from './buildResults';

describe('buildResults', () => {
  it('uses explicit ID expression', async () => {
    const objects = [{ id: '123' }, { id: '456' }];
    const expr = jsonataSafe('id');

    const result = await buildResults(objects, expr, 'id');

    expect(result).toEqual([{ id: '123' }, { id: '456' }]);
  });

  it('converts numeric IDs to strings', async () => {
    const objects = [{ id: 123 }, { id: 456 }];
    const expr = jsonataSafe('id');

    const result = await buildResults(objects, expr, 'id');

    expect(result).toEqual([{ id: '123' }, { id: '456' }]);
  });

  describe('ID fallback logic', () => {
    it.each([
      ['id', 'abc', { id: 'abc' }],
      ['uuid', 'uuid-1', { uuid: 'uuid-1', id: 'uuid-1' }],
      ['uid', 'uid-1', { uid: 'uid-1', id: 'uid-1' }],
      ['_id', 'mongo-id', { _id: 'mongo-id', id: 'mongo-id' }],
      [
        'objectID',
        'algolia-123',
        { objectID: 'algolia-123', id: 'algolia-123' },
      ],
      ['pk', 'primary-key', { pk: 'primary-key', id: 'primary-key' }],
      ['identifier', 'ident-1', { identifier: 'ident-1', id: 'ident-1' }],
      ['key', 'key-1', { key: 'key-1', id: 'key-1' }],
      ['slug', 'my-slug', { slug: 'my-slug', id: 'my-slug' }],
      ['username', 'john_doe', { username: 'john_doe', id: 'john_doe' }],
      ['login', 'user123', { login: 'user123', id: 'user123' }],
      [
        'email',
        'user@example.com',
        { email: 'user@example.com', id: 'user@example.com' },
      ],
      ['name', 'foo', { name: 'foo', id: 'foo' }],
      ['code', 'CODE123', { code: 'CODE123', id: 'CODE123' }],
      ['symbol', 'SYM', { symbol: 'SYM', id: 'SYM' }],
      ['number', 12345, { number: 12345, id: '12345' }],
    ] as const)('falls back to "%s" field', async (field, value, expected) => {
      const objects = [{ [field]: value }];
      const expr = jsonataSafe('missing');

      const result = await buildResults(objects, expr, 'missing');

      expect(result).toEqual([expected]);
    });

    it('respects fallback priority order', async () => {
      const objects = [
        { name: 'should-not-use', id: 'should-use' },
        { name: 'should-not-use', key: 'should-use-key' },
      ];
      const expr = jsonataSafe('missing');

      const result = await buildResults(objects, expr, 'missing');

      expect(result).toEqual([
        { name: 'should-not-use', id: 'should-use' },
        {
          name: 'should-not-use',
          key: 'should-use-key',
          id: 'should-use-key',
        },
      ]);
    });
  });

  it('throws error when no valid ID found', async () => {
    const objects = [{ invalid: 'field' }];
    const expr = jsonataSafe('missing');

    await expect(buildResults(objects, expr, 'missing')).rejects.toThrow(
      'Could not extract a unique ID from the response',
    );
  });

  it('throws error when ID is null', async () => {
    const objects = [{ id: null }];
    const expr = jsonataSafe('id');

    await expect(buildResults(objects, expr, 'id')).rejects.toThrow(
      'Could not extract a unique ID from the response',
    );
  });

  it('throws error when ID is empty string', async () => {
    const objects = [{ id: '' }];
    const expr = jsonataSafe('id');

    await expect(buildResults(objects, expr, 'id')).rejects.toThrow(
      'Could not extract a unique ID from the response',
    );
  });

  it('throws error when fallback ID is not string or number', async () => {
    const objects = [{ name: { nested: 'object' } }];
    const expr = jsonataSafe('missing');

    await expect(buildResults(objects, expr, 'missing')).rejects.toThrow(
      'Could not extract a unique ID from the response',
    );
  });

  it('handles complex objects with nested data', async () => {
    const objects = [
      {
        id: 'obj-1',
        data: { nested: 'value' },
        array: [1, 2, 3],
      },
    ];
    const expr = jsonataSafe('id');

    const result = await buildResults(objects, expr, 'id');

    expect(result).toEqual([
      {
        id: 'obj-1',
        data: { nested: 'value' },
        array: [1, 2, 3],
      },
    ]);
  });

  it('processes multiple objects with different ID sources', async () => {
    const objects = [
      { id: 'explicit-1' },
      { uuid: 'fallback-uuid' },
      { name: 'fallback-name' },
    ];
    const expr = jsonataSafe('missing');

    const result = await buildResults(objects, expr, 'missing');

    expect(result).toEqual([
      { id: 'explicit-1' },
      { uuid: 'fallback-uuid', id: 'fallback-uuid' },
      { name: 'fallback-name', id: 'fallback-name' },
    ]);
  });

  it('handles JSONata expression that extracts nested field', async () => {
    const objects = [{ user: { id: 'user-1' } }, { user: { id: 'user-2' } }];
    const expr = jsonataSafe('user.id');

    const result = await buildResults(objects, expr, 'user.id');

    expect(result).toEqual([
      { user: { id: 'user-1' }, id: 'user-1' },
      { user: { id: 'user-2' }, id: 'user-2' },
    ]);
  });

  it('handles JSONata concatenation across nested fields', async () => {
    const objects = [
      {
        escalation_policy: { id: 'EP123' },
        escalation_level: 1,
        user: { id: 'USER456' },
      },
    ];
    const expr = jsonataSafe(
      '$string(escalation_policy.id) & "-" & $string(escalation_level) & "-" & $string(user.id)',
    );

    const result = await buildResults(
      objects,
      expr,
      '$string(escalation_policy.id) & "-" & $string(escalation_level) & "-" & $string(user.id)',
    );

    expect(result).toEqual([
      {
        escalation_policy: { id: 'EP123' },
        escalation_level: 1,
        user: { id: 'USER456' },
        id: 'EP123-1-USER456',
      },
    ]);
  });

  it('handles string primitives using value as fallback ID', async () => {
    const objects = ['webhook_name', 'instance', 'job'];
    const expr = jsonataSafe('id');

    const result = await buildResults(objects, expr, 'id');

    expect(result).toEqual([
      { value: 'webhook_name', id: 'webhook_name' },
      { value: 'instance', id: 'instance' },
      { value: 'job', id: 'job' },
    ]);
  });

  it('handles number primitives using value as fallback ID', async () => {
    const objects = [42, 99];
    const expr = jsonataSafe('id');

    const result = await buildResults(objects, expr, 'id');

    expect(result).toEqual([
      { value: 42, id: '42' },
      { value: 99, id: '99' },
    ]);
  });

  it('handles mixed primitive and object items', async () => {
    const objects = ['label-a', { id: 'obj-1', name: 'test' }];
    const expr = jsonataSafe('id');

    const result = await buildResults(objects, expr, 'id');

    expect(result).toEqual([
      { value: 'label-a', id: 'label-a' },
      { id: 'obj-1', name: 'test' },
    ]);
  });

  it('handles real-world API response structure', async () => {
    const objects = [
      {
        name: 'foo',
        value: 'xxxx1234',
        'created-at': '#joda/inst 2023-04-14T21:20:14+0000',
      },
      {
        name: 'bar',
        value: 'yyyy5678',
        'created-at': '#joda/inst 2023-04-15T10:30:00+0000',
      },
    ];
    const expr = jsonataSafe('name');

    const result = await buildResults(objects, expr, 'name');

    expect(result).toEqual([
      {
        name: 'foo',
        value: 'xxxx1234',
        'created-at': '#joda/inst 2023-04-14T21:20:14+0000',
        id: 'foo',
      },
      {
        name: 'bar',
        value: 'yyyy5678',
        'created-at': '#joda/inst 2023-04-15T10:30:00+0000',
        id: 'bar',
      },
    ]);
  });
});
