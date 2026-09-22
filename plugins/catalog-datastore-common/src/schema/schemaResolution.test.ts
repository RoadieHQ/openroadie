import { resolveItemSchema, resolveCompositeSchema } from './schemaResolution';

describe('resolveItemSchema', () => {
  const envelopeSchema = {
    type: 'object',
    properties: {
      total_count: { type: 'integer' },
      workflows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            state: {
              type: 'string',
              enum: ['active', 'paused', 'disabled'],
            },
          },
        },
      },
    },
  };

  it('resolves nested items from explicit array path', () => {
    expect(resolveItemSchema(envelopeSchema, '$.workflows')).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        state: {
          type: 'string',
          enum: ['active', 'paused', 'disabled'],
        },
      },
    });
  });

  it('resolves root array items when expression is $', () => {
    const arrayRootSchema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    };

    expect(resolveItemSchema(arrayRootSchema, '$')).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
    });
  });

  it('resolves unique envelope array item schema for $ expression', () => {
    expect(resolveItemSchema(envelopeSchema, '$')).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        state: {
          type: 'string',
          enum: ['active', 'paused', 'disabled'],
        },
      },
    });
  });

  it('resolves oneOf with multiple object variants by merging properties', () => {
    const oneOfSchema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            login: { type: 'string' },
            private_field: { type: 'boolean' },
          },
        },
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            login: { type: 'string' },
            public_field: { type: 'string' },
          },
        },
      ],
    };

    const result = resolveItemSchema(oneOfSchema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        login: { type: 'string' },
        private_field: { type: 'boolean' },
        public_field: { type: 'string' },
      },
    });
  });

  it('resolves oneOf ignoring null variant', () => {
    const oneOfSchema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
          },
        },
        { type: 'null' },
      ],
    };

    const result = resolveItemSchema(oneOfSchema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
      },
    });
  });

  it('resolves anyOf the same as oneOf', () => {
    const anyOfSchema = {
      anyOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            a: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            b: { type: 'boolean' },
          },
        },
      ],
    };

    const result = resolveItemSchema(anyOfSchema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'boolean' },
        id: { type: 'integer' },
      },
    });
  });

  it('resolves oneOf with discriminator to enum on property', () => {
    const oneOfSchema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            user_view_type: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            user_view_type: { type: 'string' },
            admin: { type: 'boolean' },
          },
        },
      ],
      discriminator: {
        propertyName: 'user_view_type',
        mapping: {
          public: '#/components/schemas/public-user',
          private: '#/components/schemas/private-user',
        },
      },
    };

    const result = resolveItemSchema(oneOfSchema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        admin: { type: 'boolean' },
        id: { type: 'integer' },
        user_view_type: { type: 'string', enum: ['private', 'public'] },
      },
    });
  });

  it('returns full object schema instead of drilling into nested object property', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        plan: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            seats: { type: 'integer' },
          },
        },
      },
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual(schema);
  });

  it('resolves oneOf inside array items via path expression', () => {
    const schema = {
      type: 'object',
      properties: {
        users: {
          type: 'array',
          items: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  role: { type: 'string' },
                },
              },
              {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  guest: { type: 'boolean' },
                },
              },
            ],
          },
        },
      },
    };

    const result = resolveItemSchema(schema, '$.users');
    expect(result).toEqual({
      type: 'object',
      properties: {
        guest: { type: 'boolean' },
        id: { type: 'integer' },
        role: { type: 'string' },
      },
    });
  });

  it('resolves oneOf inside envelope array items with $ expression', () => {
    const schema = {
      type: 'object',
      properties: {
        users: {
          type: 'array',
          items: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  role: { type: 'string' },
                },
              },
              {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  guest: { type: 'boolean' },
                },
              },
            ],
          },
        },
      },
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        guest: { type: 'boolean' },
        id: { type: 'integer' },
        role: { type: 'string' },
      },
    });
  });

  it('resolves allOf inside envelope array items with $ expression', () => {
    const schema = {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            allOf: [
              {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                },
              },
              {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
              },
            ],
          },
        },
      },
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    });
  });

  it('resolves paginated envelope with allOf items and sibling pagination properties', () => {
    const schema = {
      type: 'object',
      title: 'Paginated Repositories',
      properties: {
        next: { type: 'string', format: 'uri' },
        page: { type: 'integer' },
        size: { type: 'integer' },
        values: {
          type: 'array',
          items: {
            allOf: [
              {
                type: 'object',
                required: ['type'],
                properties: {
                  type: { type: 'string' },
                },
                additionalProperties: true,
              },
              {
                type: 'object',
                title: 'Repository',
                properties: {
                  full_name: { type: 'string' },
                  is_private: { type: 'boolean' },
                },
                additionalProperties: true,
              },
            ],
          },
          minItems: 0,
          uniqueItems: true,
        },
        pagelen: { type: 'integer' },
        previous: { type: 'string', format: 'uri' },
      },
      additionalProperties: false,
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        full_name: { type: 'string' },
        is_private: { type: 'boolean' },
        type: { type: 'string' },
      },
      required: ['type'],
    });

    const resultNoExpr = resolveItemSchema(schema, undefined);
    expect(resultNoExpr).toEqual(result);
  });

  it('merges base schema properties with oneOf variants', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        created_at: { type: 'string', format: 'date-time' },
      },
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            a: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            b: { type: 'integer' },
          },
        },
      ],
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'integer' },
        created_at: { type: 'string', format: 'date-time' },
        id: { type: 'string' },
        kind: { type: 'string' },
      },
    });
  });

  it('merges base schema properties with allOf variants', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      allOf: [
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
          },
        },
      ],
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        id: { type: 'string' },
        name: { type: 'string' },
      },
    });
  });

  it('handles allOf variants without explicit type but with properties', () => {
    const schema = {
      allOf: [
        {
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
        },
      ],
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string' },
        id: { type: 'string' },
        name: { type: 'string' },
      },
    });
  });

  it('handles type as array with null for nullable fields', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nickname: { type: ['string', 'null'] },
        score: { type: ['integer', 'null'] },
      },
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        nickname: { type: 'string' },
        score: { type: 'integer' },
      },
    });
  });

  it('handles const as single-element enum', () => {
    const schema = {
      type: 'object',
      properties: {
        version: { type: 'string', const: 'v2' },
        kind: { const: 'user' },
        id: { type: 'integer' },
      },
    };

    const result = resolveItemSchema(schema, '$');
    expect(result).toEqual({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        kind: { type: 'string', enum: ['user'] },
        version: { type: 'string', enum: ['v2'] },
      },
    });
  });

  it('preserves required through oneOf merge', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            a: { type: 'string' },
          },
        },
        {
          type: 'object',
          required: ['id', 'role'],
          properties: {
            id: { type: 'integer' },
            role: { type: 'string' },
            b: { type: 'boolean' },
          },
        },
      ],
    };

    const result = resolveItemSchema(schema, '$') as Record<string, any>;
    expect(result.required).toBeDefined();
    expect(result.required).toEqual(
      expect.arrayContaining(['id', 'name', 'role']),
    );
  });

  it('preserves required from base schema and allOf variants', () => {
    const schema = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
      allOf: [
        {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
          },
        },
      ],
    };

    const result = resolveItemSchema(schema, '$') as Record<string, any>;
    expect(result.required).toEqual(expect.arrayContaining(['id', 'name']));
  });

  it('handles prefixItems for tuple schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        coordinates: {
          type: 'array',
          prefixItems: [{ type: 'number' }, { type: 'number' }],
        },
      },
    };

    const result = resolveItemSchema(schema, '$') as Record<string, any>;
    expect(result.properties.coordinates.type).toBe('array');
    expect(result.properties.coordinates.items).toEqual({ type: 'number' });
  });

  it('resolves type array inside oneOf variants', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            label: { type: ['string', 'null'] },
          },
        },
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            count: { type: 'number' },
          },
        },
      ],
    };

    const result = resolveItemSchema(schema, '$') as Record<string, any>;
    expect(result.properties.label).toEqual({ type: 'string' });
  });

  it('handles const inside oneOf variants for discriminator', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            type: { const: 'dog' },
            bark_volume: { type: 'integer' },
          },
        },
        {
          type: 'object',
          properties: {
            type: { const: 'cat' },
            purr_frequency: { type: 'number' },
          },
        },
      ],
    };

    const result = resolveItemSchema(schema, '$') as Record<string, any>;
    expect(result.properties.type.enum).toEqual(
      expect.arrayContaining(['cat', 'dog']),
    );
    expect(result.properties.bark_volume).toEqual({ type: 'integer' });
    expect(result.properties.purr_frequency).toEqual({ type: 'number' });
  });
});

describe('resolveCompositeSchema', () => {
  it('normalises type arrays by stripping null', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
      },
    };
    const result = resolveCompositeSchema(schema) as Record<string, any>;
    expect(result.properties.name.type).toBe('string');
  });

  it('collapses multi-type numeric arrays to number', () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: ['integer', 'number'] },
      },
    };
    const result = resolveCompositeSchema(schema) as Record<string, any>;
    expect(result.properties.score.type).toBe('number');
  });

  it('collapses mixed non-numeric type arrays to string', () => {
    const schema = {
      type: 'object',
      properties: {
        value: { type: ['integer', 'string'] },
      },
    };
    const result = resolveCompositeSchema(schema) as Record<string, any>;
    expect(result.properties.value.type).toBe('string');
  });

  it('converts const to single-element enum', () => {
    const schema = {
      type: 'object',
      properties: {
        kind: { const: 'user' },
      },
    };
    const result = resolveCompositeSchema(schema) as Record<string, any>;
    expect(result.properties.kind.enum).toEqual(['user']);
  });

  it('unions required from allOf variants', () => {
    const schema = {
      allOf: [
        {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      ],
    };
    const result = resolveCompositeSchema(schema) as Record<string, any>;
    expect(result.required).toEqual(expect.arrayContaining(['id', 'name']));
  });
});
