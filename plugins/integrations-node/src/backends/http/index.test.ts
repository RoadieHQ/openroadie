import { describe, expect, it } from 'vitest';
import { buildHttpRequestOptions, recoverLegacyHttpConfig } from './index';

describe('recoverLegacyHttpConfig', () => {
  it('parses a leftover bodyText into body for a POST with no body', () => {
    const recovered = recoverLegacyHttpConfig({
      method: 'POST',
      path: '/lookup',
      bodyText: '{"userId": "42"}',
    });
    expect(recovered.body).toEqual({ userId: '42' });
  });

  it('does not overwrite an already-parsed body', () => {
    const recovered = recoverLegacyHttpConfig({
      method: 'POST',
      path: '/lookup',
      body: { userId: '42' },
      bodyText: '{"userId": "ignored"}',
    });
    expect(recovered.body).toEqual({ userId: '42' });
  });

  it('ignores bodyText for a GET request', () => {
    const recovered = recoverLegacyHttpConfig({
      method: 'GET',
      path: '/items',
      bodyText: '{"userId": "42"}',
    });
    expect(recovered).not.toHaveProperty('body');
  });

  it('leaves unparseable bodyText alone rather than throwing', () => {
    const recovered = recoverLegacyHttpConfig({
      method: 'POST',
      path: '/lookup',
      bodyText: '{oops',
    });
    expect(recovered).not.toHaveProperty('body');
  });

  it('builds a graphql object from a leftover graphqlQuery', () => {
    const recovered = recoverLegacyHttpConfig({
      mode: 'graphql',
      path: '/graphql',
      graphqlQuery: 'query { viewer { id } }',
      graphqlVariables: '{"login": "roadie"}',
    });
    expect(recovered.graphql).toEqual({
      query: 'query { viewer { id } }',
      variables: { login: 'roadie' },
    });
  });

  it('leaves a config with no legacy fields untouched', () => {
    const config = {
      method: 'POST',
      path: '/lookup',
      body: { a: 1 },
    };
    expect(recoverLegacyHttpConfig(config)).toBe(config);
  });
});

describe('buildHttpRequestOptions legacy recovery', () => {
  it('sends the body for a POST config that only has bodyText', () => {
    const { requestOptions } = buildHttpRequestOptions({
      integrationId: 'int-1',
      method: 'POST',
      path: '/lookup',
      arrayExpression: '$',
      bodyText: '{"userId": "42"}',
    });
    expect(requestOptions.method).toBe('POST');
    expect(requestOptions.body).toEqual({ userId: '42' });
  });
});
