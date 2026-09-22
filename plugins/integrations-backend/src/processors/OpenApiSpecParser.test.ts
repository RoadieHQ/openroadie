import { describe, expect, it } from 'vitest';
import { OpenApiSpecParser } from './OpenApiSpecParser';

describe('OpenApiSpecParser', () => {
  it('parses schemas from application/vnd.api+json responses', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/issues': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/vnd.api+json': {
                    schema: {
                      type: 'object',
                      properties: { data: { type: 'array' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(parser.parse(spec)).toEqual([
      {
        pathPattern: '/issues',
        method: 'GET',
        jsonSchema: {
          type: 'object',
          properties: { data: { type: 'array' } },
        },
        description: undefined,
      },
    ]);
  });

  it('parses schemas from +json media types', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/reports': {
          post: {
            responses: {
              '200': {
                content: {
                  'application/problem+json': {
                    schema: {
                      type: 'object',
                      properties: { title: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(parser.parse(spec)).toEqual([
      {
        pathPattern: '/reports',
        method: 'POST',
        jsonSchema: {
          type: 'object',
          properties: { title: { type: 'string' } },
        },
        description: undefined,
      },
    ]);
  });

  it('parses schemas from any 2xx response code', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/jobs': {
          get: {
            responses: {
              '299': {
                content: {
                  'application/vnd.api+json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(parser.parse(spec)).toEqual([
      {
        pathPattern: '/jobs',
        method: 'GET',
        jsonSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        description: undefined,
      },
    ]);
  });

  it('prefixes OpenAPI 3 paths with server base path', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      servers: [{ url: 'https://api.snyk.io/rest' }],
      paths: {
        '/orgs': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/vnd.api+json': {
                    schema: {
                      type: 'object',
                      properties: { data: { type: 'array' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(parser.parse(spec)).toEqual([
      {
        pathPattern: '/rest/orgs',
        method: 'GET',
        jsonSchema: {
          type: 'object',
          properties: { data: { type: 'array' } },
        },
        description: undefined,
      },
    ]);
  });

  it('extracts summary as description when present', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {
            summary: 'List all users',
            description: 'Returns a paginated list of all users in the system',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'object' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('List all users');
  });

  it('falls back to description when summary is absent', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {
            description: 'Returns a paginated list of all users',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'object' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('Returns a paginated list of all users');
  });

  it('extracts description from Swagger 2.x specs', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      swagger: '2.0',
      basePath: '/api/v1',
      paths: {
        '/pets': {
          get: {
            summary: 'List pets',
            responses: {
              '200': {
                schema: {
                  type: 'array',
                  items: { type: 'object' },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('List pets');
    expect(result[0].pathPattern).toBe('/api/v1/pets');
  });

  it('extracts link pagination hint from per_page + page query parameters', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/repos': {
          get: {
            parameters: [
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', default: 1 },
              },
              {
                name: 'per_page',
                in: 'query',
                schema: { type: 'integer', default: 50 },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].paginationHint).toEqual({
      type: 'link',
      perPageParam: 'per_page',
      perPage: 100,
    });
  });

  it('prefers maximum page size over default in pagination hints', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/repos': {
          get: {
            parameters: [
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', default: 1 },
              },
              {
                name: 'per_page',
                in: 'query',
                schema: { type: 'integer', default: 30, maximum: 100 },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].paginationHint).toEqual({
      type: 'link',
      perPageParam: 'per_page',
      perPage: 100,
    });
  });

  it('extracts page pagination hint when page size uses non-link convention', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/repos': {
          get: {
            parameters: [
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', default: 1 },
              },
              {
                name: 'page_size',
                in: 'query',
                schema: { type: 'integer', default: 50 },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].paginationHint).toEqual({
      type: 'page',
      pageParam: 'page',
      perPageParam: 'page_size',
      perPage: 100,
      startPage: 1,
    });
  });

  it('extracts offset pagination hint from query parameters', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/issues': {
          get: {
            parameters: [
              { name: 'offset', in: 'query', schema: { type: 'integer' } },
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', default: 25 },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].paginationHint).toEqual({
      type: 'offset',
      offsetParam: 'offset',
      limitParam: 'limit',
      limit: 100,
    });
  });

  it('prefers maximum limit over default for offset pagination hints', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/issues': {
          get: {
            parameters: [
              { name: 'offset', in: 'query', schema: { type: 'integer' } },
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', default: 30, maximum: 100 },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].paginationHint).toEqual({
      type: 'offset',
      offsetParam: 'offset',
      limitParam: 'limit',
      limit: 100,
    });
  });

  it('extracts cursor pagination hint from query parameters', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/events': {
          get: {
            parameters: [
              { name: 'cursor', in: 'query', schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].paginationHint).toEqual({
      type: 'cursor',
      cursorParam: 'cursor',
    });
  });

  it('extracts link pagination hint when success response defines Link header', () => {
    const parser = new OpenApiSpecParser();
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/issues': {
          get: {
            responses: {
              '200': {
                headers: {
                  Link: {
                    schema: { type: 'string' },
                  },
                },
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = parser.parse(spec);
    expect(result).toHaveLength(1);
    expect(result[0].paginationHint).toEqual({
      type: 'link',
      perPageParam: undefined,
      perPage: 100,
    });
  });
});
