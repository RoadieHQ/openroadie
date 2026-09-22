import { validateAgainstSchema, autoFixSchema } from './schemaValidation';

describe('validateAgainstSchema', () => {
  it('returns no errors when data matches schema', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
    };
    const items = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    expect(validateAgainstSchema(items, schema)).toEqual([]);
  });

  it('detects type mismatch', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    };
    const items = [{ name: 42 }];
    const errors = validateAgainstSchema(items, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('[0].name');
    expect(errors[0].expected).toBe('type "string"');
    expect(errors[0].actual).toBe('type "integer"');
  });

  it('detects enum violation', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed'] },
      },
    };
    const items = [{ status: 'pending' }];
    const errors = validateAgainstSchema(items, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].expected).toContain('one of');
    expect(errors[0].actual).toBe('"pending"');
  });
});

describe('autoFixSchema', () => {
  it('returns original schema when no errors exist', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
    };
    const items = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const result = autoFixSchema(items, schema);
    expect(result.corrections).toHaveLength(0);
    expect(result.fixedSchema).toBe(schema);
  });

  it('widens integer to number for type mismatch', () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'integer' },
      },
    };
    const items = [{ score: 3.14 }];
    const result = autoFixSchema(items, schema);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toEqual({
      field: 'score',
      type: 'type_widened',
      before: 'integer',
      after: 'number',
    });
    const fixed = result.fixedSchema as Record<string, any>;
    expect(fixed.properties.score.type).toBe('number');
  });

  it('changes type for string to integer mismatch', () => {
    const schema = {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    };
    const items = [{ value: 42 }];
    const result = autoFixSchema(items, schema);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toEqual({
      field: 'value',
      type: 'type_widened',
      before: 'string',
      after: 'integer',
    });
    const fixed = result.fixedSchema as Record<string, any>;
    expect(fixed.properties.value.type).toBe('integer');
  });

  it('adds missing enum values', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed'] },
      },
    };
    const items = [{ status: 'pending' }, { status: 'archived' }];
    const result = autoFixSchema(items, schema);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toEqual({
      field: 'status',
      type: 'enum_extended',
      before: '"open", "closed"',
      after: '"pending", "archived"',
    });
    const fixed = result.fixedSchema as Record<string, any>;
    expect(fixed.properties.status.enum).toContain('pending');
    expect(fixed.properties.status.enum).toContain('archived');
    expect(fixed.properties.status.enum).toContain('open');
    expect(fixed.properties.status.enum).toContain('closed');
  });

  it('handles both type and enum corrections in one pass', () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        status: { type: 'string', enum: ['active'] },
      },
    };
    const items = [{ count: 3.14, status: 'inactive' }];
    const result = autoFixSchema(items, schema);
    expect(result.corrections).toHaveLength(2);
    const types = result.corrections.map(c => c.type);
    expect(types).toContain('type_widened');
    expect(types).toContain('enum_extended');
  });

  it('does not mutate the original schema', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed'] },
      },
    };
    const items = [{ status: 'pending' }];
    autoFixSchema(items, schema);
    expect((schema.properties.status as Record<string, any>).enum).toEqual([
      'open',
      'closed',
    ]);
  });

  it('returns original schema for non-object schemas', () => {
    const schema = { type: 'array', items: {} };
    const result = autoFixSchema([1, 2, 3], schema);
    expect(result.corrections).toHaveLength(0);
    expect(result.fixedSchema).toBe(schema);
  });

  it('returns original schema for null/undefined inputs', () => {
    const result = autoFixSchema([], null as any);
    expect(result.corrections).toHaveLength(0);
  });

  it('widens to string when multiple non-numeric types are seen', () => {
    const schema = {
      type: 'object',
      properties: {
        value: { type: 'integer' },
      },
    };
    const items = [{ value: 'hello' }, { value: true }];
    const result = autoFixSchema(items, schema);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toEqual({
      field: 'value',
      type: 'type_widened',
      before: 'integer',
      after: 'string',
    });
    const fixed = result.fixedSchema as Record<string, any>;
    expect(fixed.properties.value.type).toBe('string');
  });
});
