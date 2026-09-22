import { describe, expect, it } from 'vitest';
import { parseHttpSourceConfig } from './schemas';

describe('httpSourceConfigSchema', () => {
  it('parses a REST config with the GET method default', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/orgs/roadie/members',
      arrayExpression: '$',
    });
    expect(parsed.mode).toBe('rest');
    expect(parsed.method).toBe('GET');
  });

  it('parses a POST method', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/graphql',
      method: 'POST',
      arrayExpression: '$',
    });
    expect(parsed.method).toBe('POST');
  });

  it('rejects unsupported methods', () => {
    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/x',
        method: 'PUT',
        arrayExpression: '$',
      }),
    ).toThrow();
  });

  it('parses a GraphQL mode config', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/graphql',
      method: 'POST',
      mode: 'graphql',
      arrayExpression: 'data.viewer',
      graphql: {
        query: 'query($login:String!){ user(login:$login){ id } }',
        variables: { login: 'dt' },
      },
    });
    expect(parsed.mode).toBe('graphql');
    expect(parsed.graphql?.query).toMatch(/user\(login/);
    expect(parsed.graphql?.variables).toEqual({ login: 'dt' });
  });

  it('rejects a GraphQL config with multiple operation definitions', () => {
    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/graphql',
        method: 'POST',
        mode: 'graphql',
        arrayExpression: 'data.viewer',
        graphql: {
          query:
            'query A { viewer { id } }\nquery B { rateLimit { remaining } }',
        },
      }),
    ).toThrow(/Multi-operation/);
  });

  it('accepts a GraphQL config containing a fragment alongside one operation', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/graphql',
      method: 'POST',
      mode: 'graphql',
      arrayExpression: 'data.viewer',
      graphql: {
        query:
          'fragment UserFields on User { id login }\nquery GetUser { viewer { ...UserFields } }',
      },
    });
    expect(parsed.graphql?.query).toMatch(/GetUser/);
  });

  it('does not pre-validate GraphQL syntax — invalid queries are forwarded to the upstream', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/graphql',
      method: 'POST',
      mode: 'graphql',
      arrayExpression: 'data',
      graphql: {
        query: 'this is not valid graphql {',
      },
    });
    expect(parsed.graphql?.query).toContain('not valid');
  });

  it('parses graphql-cursor pagination', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/graphql',
      arrayExpression: '$',
      pagination: {
        type: 'graphql-cursor',
        cursorVariable: 'after',
        nextCursorExpression: 'data.org.members.pageInfo.endCursor',
        hasNextPageExpression: 'data.org.members.pageInfo.hasNextPage',
      },
    });
    expect(parsed.pagination?.type).toBe('graphql-cursor');
  });

  it('rejects graphql-cursor without the required cursor fields', () => {
    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/graphql',
        arrayExpression: '$',
        pagination: {
          type: 'graphql-cursor',
        },
      }),
    ).toThrow();
  });

  it('parses link pagination with a next-link condition', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/issues',
      arrayExpression: '$',
      pagination: {
        type: 'link',
        perPageParam: 'per_page',
        perPage: 100,
        nextLinkCondition: {
          param: 'results',
          equals: 'true',
        },
      },
    });

    expect(parsed.pagination).toEqual({
      type: 'link',
      perPageParam: 'per_page',
      perPage: 100,
      nextLinkCondition: {
        param: 'results',
        equals: 'true',
      },
    });
  });

  it('parses link pagination with a follow-up request method override', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/issues',
      arrayExpression: '$',
      pagination: {
        type: 'link',
        nextRequestMethod: 'GET',
      },
    });

    expect(parsed.pagination).toEqual({
      type: 'link',
      nextRequestMethod: 'GET',
    });
  });

  it('parses cursor pagination with a nested body params path', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/search',
      method: 'POST',
      body: { options: {} },
      arrayExpression: 'results',
      pagination: {
        type: 'cursor',
        cursorParam: '$skipToken',
        nextCursorExpression: 'skipToken',
        paramLocation: 'body',
        bodyParamsPath: 'options',
      },
    });

    expect(parsed.pagination).toEqual({
      type: 'cursor',
      cursorParam: '$skipToken',
      nextCursorExpression: 'skipToken',
      paramLocation: 'body',
      bodyParamsPath: 'options',
    });
  });

  it('rejects a cursor body params path unless params are placed in the body', () => {
    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/search',
        arrayExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'cursor',
          nextCursorExpression: 'next_cursor',
          paramLocation: 'query',
          bodyParamsPath: 'options',
        },
      }),
    ).toThrow(/bodyParamsPath requires paramLocation/);

    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/search',
        arrayExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'cursor',
          nextCursorExpression: 'next_cursor',
          bodyParamsPath: 'options',
        },
      }),
    ).toThrow(/bodyParamsPath requires paramLocation/);
  });

  it('parses offset pagination with body parameter placement and total expression', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/search',
      method: 'POST',
      body: { searchText: 'catalog-info.yaml' },
      arrayExpression: 'results',
      pagination: {
        type: 'offset',
        offsetParam: '$skip',
        limitParam: '$top',
        limit: 1000,
        paramLocation: 'body',
        totalExpression: 'count',
      },
    });

    expect(parsed.pagination).toEqual({
      type: 'offset',
      offsetParam: '$skip',
      limitParam: '$top',
      limit: 1000,
      paramLocation: 'body',
      totalExpression: 'count',
    });
  });

  it('parses offset pagination with a nested body params path', () => {
    const parsed = parseHttpSourceConfig({
      integrationId: 'i-1',
      path: '/search',
      method: 'POST',
      body: { options: {} },
      arrayExpression: 'results',
      pagination: {
        type: 'offset',
        offsetParam: '$skip',
        limitParam: '$top',
        limit: 1000,
        paramLocation: 'body',
        bodyParamsPath: 'options',
        totalExpression: 'count',
      },
    });

    expect(parsed.pagination).toEqual({
      type: 'offset',
      offsetParam: '$skip',
      limitParam: '$top',
      limit: 1000,
      paramLocation: 'body',
      bodyParamsPath: 'options',
      totalExpression: 'count',
    });
  });

  it('rejects a body params path unless params are placed in the body', () => {
    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/search',
        arrayExpression: '$',
        pagination: {
          type: 'offset',
          offsetParam: 'offset',
          limitParam: 'limit',
          limit: 100,
          paramLocation: 'query',
          bodyParamsPath: 'options',
        },
      }),
    ).toThrow(/bodyParamsPath requires paramLocation/);

    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/search',
        arrayExpression: '$',
        pagination: {
          type: 'offset',
          offsetParam: 'offset',
          limitParam: 'limit',
          limit: 100,
          bodyParamsPath: 'options',
        },
      }),
    ).toThrow(/bodyParamsPath requires paramLocation/);
  });

  it('rejects offset pagination with an unknown parameter location', () => {
    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/search',
        arrayExpression: '$',
        pagination: {
          type: 'offset',
          offsetParam: 'offset',
          limitParam: 'limit',
          limit: 100,
          paramLocation: 'header',
        },
      }),
    ).toThrow();
  });

  it('rejects next-link conditions without a comparator', () => {
    expect(() =>
      parseHttpSourceConfig({
        integrationId: 'i-1',
        path: '/issues',
        arrayExpression: '$',
        pagination: {
          type: 'link',
          nextLinkCondition: {
            param: 'results',
          },
        },
      }),
    ).toThrow(/nextLinkCondition requires equals or notEquals/);
  });
});
