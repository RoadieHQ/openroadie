import {
  getShape,
  computeSchemaHash,
  generateSchemaDescription,
} from './schemaInference';

describe('getShape', () => {
  it('returns empty object for empty input', () => {
    expect(getShape([])).toEqual({});
  });

  it('infers JSON Schema from a single object', () => {
    const result = getShape([{ name: 'Alice', age: 30, active: true }]);
    expect(result).toEqual({
      type: 'object',
      properties: {
        active: { type: 'boolean' },
        age: { type: 'integer' },
        name: { type: 'string' },
      },
    });
  });

  it('sorts keys alphabetically', () => {
    const result = getShape([{ zebra: 1, apple: 'a', mango: true }]);
    const props = (result as Record<string, unknown>).properties as Record<
      string,
      unknown
    >;
    expect(Object.keys(props)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('handles nested objects', () => {
    const result = getShape([
      { user: { name: 'Alice', address: { city: 'NYC' } } },
    ]);
    expect(result).toEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            address: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
            name: { type: 'string' },
          },
        },
      },
    });
  });

  it('handles arrays', () => {
    const result = getShape([{ tags: ['a', 'b'] }]);
    expect(result).toEqual({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
  });

  it('handles empty arrays', () => {
    const result = getShape([{ items: [] }]);
    expect(result).toEqual({
      type: 'object',
      properties: {
        items: { type: 'array', items: {} },
      },
    });
  });

  it('handles null values', () => {
    const result = getShape([{ value: null }]);
    expect(result).toEqual({
      type: 'object',
      properties: { value: { type: 'null' } },
    });
  });

  it('merges fields across multiple items', () => {
    const result = getShape([
      { name: 'Alice', age: 30 },
      { name: 'Bob', email: 'bob@example.com' },
    ]);
    expect(result).toEqual({
      type: 'object',
      properties: {
        age: { type: 'integer' },
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
      },
    });
  });

  it('detects mixed types across items', () => {
    const result = getShape([{ value: 'hello' }, { value: 42 }]);
    expect(result).toEqual({
      type: 'object',
      properties: { value: {} },
    });
  });

  it('keeps the non-null type when a field is null in some items', () => {
    expect(
      getShape([{ email: 'a@b.com' }, { email: null }, { email: 'c@d.com' }]),
    ).toEqual({
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
    });
    expect(getShape([{ score: 10 }, { score: null }])).toEqual({
      type: 'object',
      properties: { score: { type: 'integer' } },
    });
  });

  it('handles deeply nested mixed objects', () => {
    const result = getShape([
      { meta: { score: 10 } },
      { meta: { score: 'high' } },
    ]);
    expect(result).toEqual({
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          properties: { score: {} },
        },
      },
    });
  });

  it.each([
    ['date-time', 'created', ['2024-01-15T10:30:00Z', '2024-02-20T14:00:00Z']],
    ['uri', 'url', ['https://example.com/page1', 'https://example.com/page2']],
    ['email', 'email', ['alice@example.com', 'bob@example.com']],
  ] as const)('detects %s format', (format, key, values) => {
    const result = getShape(values.map(value => ({ [`${key}`]: value })));
    expect(result).toEqual({
      type: 'object',
      properties: {
        [`${key}`]: { type: 'string', format },
      },
    });
  });

  it('distinguishes integer from number', () => {
    const result = getShape([{ count: 5, ratio: 3.14 }]);
    expect(result).toEqual({
      type: 'object',
      properties: {
        count: { type: 'integer' },
        ratio: { type: 'number' },
      },
    });
  });

  it('handles deeply nested optional fields', () => {
    const result = getShape([
      { meta: { score: 10 } },
      { meta: { score: null } },
    ]);
    expect(result).toEqual({
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          properties: { score: { type: 'integer' } },
        },
      },
    });
  });
});

describe('computeSchemaHash', () => {
  it('returns a string hash', () => {
    const hash = computeSchemaHash({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
    });
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^sh_/);
  });

  it('returns same hash for same shape', () => {
    const shape = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    };
    expect(computeSchemaHash(shape)).toBe(computeSchemaHash(shape));
  });

  it('returns different hash for different shapes', () => {
    const hash1 = computeSchemaHash({
      type: 'object',
      properties: { a: { type: 'string' } },
    });
    const hash2 = computeSchemaHash({
      type: 'object',
      properties: { a: { type: 'number' } },
    });
    expect(hash1).not.toBe(hash2);
  });
});

describe('generateSchemaDescription', () => {
  it('returns the datasource name', () => {
    const desc = generateSchemaDescription('my-pipeline', {
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
    });
    expect(desc).toBe('my-pipeline');
  });
});
