import { deriveOutputSchema } from './schemaDeriveOutput';

describe('deriveOutputSchema', () => {
  const sourceItemSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      state: {
        type: 'string',
        enum: ['active', 'paused', 'disabled'],
      },
    },
  };

  const envelopeSchema = {
    type: 'object',
    properties: {
      total_count: { type: 'integer' },
      workflows: {
        type: 'array',
        items: sourceItemSchema,
      },
    },
  };

  const sourceData = [
    { id: '1', state: 'active' },
    { id: '2', state: 'paused' },
    { id: '3', state: 'disabled' },
    { id: '4', state: 'active' },
    { id: '5', state: 'paused' },
    { id: '6', state: 'disabled' },
  ];

  it('keeps full source enum when output sample only has subset values', () => {
    const outputData = [
      { id: '1', state: 'active' },
      { id: '4', state: 'active' },
      { id: '2', state: 'paused' },
      { id: '1', state: 'active' },
      { id: '4', state: 'active' },
      { id: '2', state: 'paused' },
    ];

    const derived = deriveOutputSchema(
      sourceItemSchema,
      sourceData,
      outputData,
    ) as {
      properties: Record<string, any>;
    };
    expect(derived.properties.state.enum).toEqual([
      'active',
      'paused',
      'disabled',
    ]);
  });

  it('keeps full enum in direct source to sink flow with envelope source schema', () => {
    const outputData = [
      { id: '1', state: 'active' },
      { id: '2', state: 'active' },
      { id: '3', state: 'active' },
      { id: '4', state: 'active' },
      { id: '5', state: 'active' },
      { id: '6', state: 'active' },
    ];

    const derived = deriveOutputSchema(
      envelopeSchema,
      sourceData,
      outputData,
    ) as {
      properties: Record<string, any>;
    };
    expect(derived.properties.state.enum).toEqual([
      'active',
      'paused',
      'disabled',
    ]);
  });

  describe('chained source nested objects', () => {
    const sourceSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['active', 'paused', 'disabled'],
          description: 'Current status',
        },
        url: { type: 'string', format: 'uri' },
      },
    };

    const chainedSourceData = [
      { id: '1', status: 'active', url: 'https://example.com/1' },
      { id: '2', status: 'paused', url: 'https://example.com/2' },
      { id: '3', status: 'disabled', url: 'https://example.com/3' },
      { id: '4', status: 'active', url: 'https://example.com/4' },
      { id: '5', status: 'paused', url: 'https://example.com/5' },
      { id: '6', status: 'disabled', url: 'https://example.com/6' },
    ];

    it('propagates source enum and description into _parent for flatten mode', () => {
      const outputData = [
        {
          name: 'r-a',
          _parent: {
            id: '1',
            status: 'active',
            url: 'https://example.com/1',
          },
        },
        {
          name: 'r-b',
          _parent: {
            id: '2',
            status: 'paused',
            url: 'https://example.com/2',
          },
        },
        {
          name: 'r-c',
          _parent: {
            id: '3',
            status: 'disabled',
            url: 'https://example.com/3',
          },
        },
        {
          name: 'r-d',
          _parent: {
            id: '4',
            status: 'active',
            url: 'https://example.com/4',
          },
        },
        {
          name: 'r-e',
          _parent: {
            id: '5',
            status: 'paused',
            url: 'https://example.com/5',
          },
        },
        {
          name: 'r-f',
          _parent: {
            id: '6',
            status: 'disabled',
            url: 'https://example.com/6',
          },
        },
      ];

      const derived = deriveOutputSchema(
        sourceSchema,
        chainedSourceData,
        outputData,
      ) as {
        properties: Record<string, any>;
      };

      expect(derived.properties._parent.properties.status.enum).toEqual([
        'active',
        'paused',
        'disabled',
      ]);
      expect(derived.properties._parent.properties.status.description).toBe(
        'Current status',
      );
    });

    it('propagates full source enum into _parent even when output has value subset', () => {
      const outputData = [
        {
          name: 'r-a',
          _parent: {
            id: '1',
            status: 'active',
            url: 'https://example.com/1',
          },
        },
        {
          name: 'r-b',
          _parent: {
            id: '3',
            status: 'active',
            url: 'https://example.com/3',
          },
        },
        {
          name: 'r-c',
          _parent: {
            id: '5',
            status: 'active',
            url: 'https://example.com/5',
          },
        },
        {
          name: 'r-d',
          _parent: {
            id: '1',
            status: 'active',
            url: 'https://example.com/1',
          },
        },
        {
          name: 'r-e',
          _parent: {
            id: '3',
            status: 'active',
            url: 'https://example.com/3',
          },
        },
        {
          name: 'r-f',
          _parent: {
            id: '5',
            status: 'active',
            url: 'https://example.com/5',
          },
        },
      ];

      const derived = deriveOutputSchema(
        sourceSchema,
        chainedSourceData,
        outputData,
      ) as {
        properties: Record<string, any>;
      };

      expect(derived.properties._parent.properties.status.enum).toEqual(
        expect.arrayContaining(['active', 'paused', 'disabled']),
      );
      expect(derived.properties._parent.properties.status.description).toBe(
        'Current status',
      );
    });

    it('infers structural schema for _additionalData nested items without enum', () => {
      const items = [];
      for (let i = 0; i < 10; i++) {
        items.push({
          id: `${i}`,
          status: i % 2 === 0 ? 'active' : 'paused',
          url: `https://example.com/${i}`,
          _additionalData: {
            details: [
              {
                severity: i % 2 === 0 ? 'high' : 'low',
                note: `note-${i}-a`,
              },
              { severity: 'medium', note: `note-${i}-b` },
            ],
          },
        });
      }

      const derived = deriveOutputSchema(
        sourceSchema,
        chainedSourceData,
        items,
      ) as {
        properties: Record<string, any>;
      };

      const detailsItems =
        derived.properties._additionalData?.properties?.details?.items;
      expect(detailsItems).toBeDefined();
      expect(detailsItems.properties.severity.type).toBe('string');
      expect(detailsItems.properties.severity.enum).toBeUndefined();
    });
  });

  it('propagates enum from oneOf source schema', () => {
    const oneOfSourceSchema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'suspended'],
            },
          },
        },
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'suspended'],
            },
            admin: { type: 'boolean' },
          },
        },
      ],
    };

    const srcData = [
      { id: 1, status: 'active' },
      { id: 2, status: 'inactive' },
      { id: 3, status: 'suspended' },
      { id: 4, status: 'active' },
      { id: 5, status: 'inactive' },
      { id: 6, status: 'suspended' },
    ];

    const outData = [
      { id: 1, status: 'active' },
      { id: 4, status: 'active' },
      { id: 1, status: 'active' },
      { id: 4, status: 'active' },
      { id: 1, status: 'active' },
      { id: 4, status: 'active' },
    ];

    const derived = deriveOutputSchema(oneOfSourceSchema, srcData, outData) as {
      properties: Record<string, any>;
    };

    expect(derived.properties.status.enum).toEqual(
      expect.arrayContaining(['active', 'inactive', 'suspended']),
    );
  });

  it('matches fingerprints across renamed fields when source and output sizes differ', () => {
    const sourceSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['active', 'paused', 'disabled'],
        },
      },
    };

    const sourceRows = [
      { id: '1', status: 'active' },
      { id: '2', status: 'paused' },
      { id: '3', status: 'disabled' },
      { id: '4', status: 'active' },
      { id: '5', status: 'paused' },
      { id: '6', status: 'disabled' },
    ];

    const outputRows = [
      { externalState: 'active' },
      { externalState: 'paused' },
      { externalState: 'disabled' },
      { externalState: 'active' },
    ];

    const derived = deriveOutputSchema(
      sourceSchema,
      sourceRows,
      outputRows,
    ) as {
      properties: Record<string, any>;
    };

    expect(derived.properties.externalState.enum).toEqual(
      expect.arrayContaining(['active', 'paused', 'disabled']),
    );
  });

  it('preserves top-level required fields from source schema', () => {
    const schema = {
      type: 'object',
      required: ['id', 'name', 'slug'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
      },
    };

    const data = [
      { id: 1, name: 'Team A', slug: 'team-a', description: 'First' },
      { id: 2, name: 'Team B', slug: 'team-b', description: 'Second' },
      { id: 3, name: 'Team C', slug: 'team-c', description: 'Third' },
      { id: 4, name: 'Team D', slug: 'team-d', description: 'Fourth' },
      { id: 5, name: 'Team E', slug: 'team-e', description: 'Fifth' },
      { id: 6, name: 'Team F', slug: 'team-f', description: 'Sixth' },
    ];

    const derived = deriveOutputSchema(schema, data, data) as any;
    expect(derived.required).toEqual(
      expect.arrayContaining(['id', 'name', 'slug']),
    );
    expect(derived.required).not.toContain('description');
  });

  it('preserves nested object enum, required, and nullable', () => {
    const schema = {
      type: 'object',
      required: ['id', 'type', 'parent'],
      properties: {
        id: { type: 'integer' },
        type: {
          type: 'string',
          enum: ['enterprise', 'organization'],
          description: 'The ownership type of the team',
        },
        parent: {
          type: 'object',
          required: ['id', 'slug', 'type'],
          nullable: true,
          properties: {
            id: { type: 'integer' },
            slug: { type: 'string' },
            type: {
              type: 'string',
              enum: ['enterprise', 'organization'],
              description: 'The ownership type of the team',
            },
          },
        },
      },
    };

    const data = [
      {
        id: 1,
        type: 'organization',
        parent: { id: 10, slug: 'eng', type: 'enterprise' },
      },
      {
        id: 2,
        type: 'organization',
        parent: { id: 10, slug: 'eng', type: 'enterprise' },
      },
      {
        id: 3,
        type: 'enterprise',
        parent: { id: 10, slug: 'eng', type: 'enterprise' },
      },
      {
        id: 4,
        type: 'organization',
        parent: { id: 11, slug: 'ops', type: 'organization' },
      },
      {
        id: 5,
        type: 'enterprise',
        parent: { id: 11, slug: 'ops', type: 'organization' },
      },
      {
        id: 6,
        type: 'organization',
        parent: { id: 11, slug: 'ops', type: 'organization' },
      },
    ];

    const derived = deriveOutputSchema(schema, data, data) as any;
    expect(derived.required).toEqual(
      expect.arrayContaining(['id', 'type', 'parent']),
    );
    expect(derived.properties.type.enum).toEqual([
      'enterprise',
      'organization',
    ]);
    expect(derived.properties.type.description).toBe(
      'The ownership type of the team',
    );

    const parentSchema = derived.properties.parent;
    expect(parentSchema.required).toEqual(
      expect.arrayContaining(['id', 'slug', 'type']),
    );
    expect(parentSchema.nullable).toBe(true);
    expect(parentSchema.properties.type.enum).toEqual([
      'enterprise',
      'organization',
    ]);
    expect(parentSchema.properties.type.description).toBe(
      'The ownership type of the team',
    );
  });

  it('preserves examples and example from source schema fields', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string', examples: ['abc-123', 'def-456'] },
        status: {
          type: 'string',
          example: 'active',
          enum: ['active', 'paused'],
        },
      },
    };

    const data = [
      { id: 'abc-123', status: 'active' },
      { id: 'def-456', status: 'paused' },
      { id: 'ghi-789', status: 'active' },
      { id: 'jkl-012', status: 'paused' },
      { id: 'mno-345', status: 'active' },
      { id: 'pqr-678', status: 'paused' },
    ];

    const derived = deriveOutputSchema(schema, data, data) as any;
    expect(derived.properties.id.examples).toEqual(['abc-123', 'def-456']);
    expect(derived.properties.status.example).toBe('active');
    expect(derived.properties.status.enum).toEqual(['active', 'paused']);
  });

  it('preserves required only for fields present in output', () => {
    const schema = {
      type: 'object',
      required: ['id', 'name', 'email'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
    };

    const data = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Carol' },
      { id: 4, name: 'Dave' },
      { id: 5, name: 'Eve' },
      { id: 6, name: 'Frank' },
    ];

    const derived = deriveOutputSchema(schema, data, data) as any;
    expect(derived.required).toEqual(expect.arrayContaining(['id', 'name']));
    expect(derived.required).not.toContain('email');
  });

  it('does not merge fallback metadata when field lookup is ambiguous', () => {
    const ambiguousSchema = {
      type: 'object',
      properties: {
        left: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['x', 'y'] },
          },
        },
        right: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['a', 'b'] },
          },
        },
      },
    };

    const outputData = [
      { state: 'active' },
      { state: 'paused' },
      { state: 'active' },
      { state: 'paused' },
      { state: 'active' },
      { state: 'paused' },
    ];

    const derived = deriveOutputSchema(
      ambiguousSchema,
      outputData,
      outputData,
    ) as {
      properties: Record<string, any>;
    };
    expect(derived.properties.state.enum).toBeUndefined();
  });
});
