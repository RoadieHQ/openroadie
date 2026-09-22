import { renderHook } from '@testing-library/react';
import { useDataSourceBuilder } from './use-data-source-builder';

describe('useDataSourceBuilder', () => {
  it('builds a source-datastore node from a datastore source (sc-33950)', () => {
    const { result } = renderHook(() =>
      useDataSourceBuilder({
        triggerType: 'schedule',
        triggerConfig: { frequencyValue: 1, frequencyUnit: 'hours' },
        sourceType: 'datastore',
        sourceConfig: {
          datasourceId: 'ds-upstream',
          datasourceName: 'GitHub Users',
        },
        transforms: [],
        sinks: [{ id: 'sink-1', type: 'datastore', config: {} }],
        confirmedSinkSchema: {},
      }),
    );

    const nodes = result.current.buildWorkflowNodes();
    const sourceNode = nodes.find(n => n.id === 'source-node');

    expect(sourceNode).toMatchObject({
      type: 'source-datastore',
      data: {
        label: 'Data Source',
        config: {
          datasourceId: 'ds-upstream',
          datasourceName: 'GitHub Users',
        },
      },
    });

    const edges = result.current.buildWorkflowEdges();
    expect(edges).toEqual([
      expect.objectContaining({
        source: 'trigger-node',
        target: 'source-node',
      }),
      expect.objectContaining({ source: 'source-node', target: 'sink-1' }),
    ]);
  });
});

function buildSourceNodeConfig(sourceConfig: Record<string, unknown>) {
  const { result } = renderHook(() =>
    useDataSourceBuilder({
      triggerType: 'schedule',
      triggerConfig: {},
      sourceType: 'http',
      sourceConfig,
      transforms: [],
      sinks: [],
      confirmedSinkSchema: {},
    }),
  );
  const sourceNode = result.current
    .buildWorkflowNodes()
    .find(n => n.id === 'source-node');
  if (!sourceNode) {
    throw new Error('source node not built');
  }
  return sourceNode.data.config as Record<string, unknown>;
}

describe('useDataSourceBuilder http body serialization', () => {
  it('parses bodyText into body for POST and strips bodyText', () => {
    const config = buildSourceNodeConfig({
      integrationId: 'int-1',
      method: 'POST',
      path: '/search',
      bodyText: '{"query": "status:active"}',
    });
    expect(config.method).toBe('POST');
    expect(config.body).toEqual({ query: 'status:active' });
    expect(config).not.toHaveProperty('bodyText');
  });

  it('keeps an existing body when the editor was never touched', () => {
    const config = buildSourceNodeConfig({
      integrationId: 'int-1',
      method: 'POST',
      path: '/search',
      body: { a: 1 },
    });
    expect(config.body).toEqual({ a: 1 });
  });

  it('drops the body when bodyText is cleared', () => {
    const config = buildSourceNodeConfig({
      integrationId: 'int-1',
      method: 'POST',
      path: '/search',
      body: { a: 1 },
      bodyText: '   ',
    });
    expect(config).not.toHaveProperty('body');
  });

  it('drops an unparseable bodyText instead of saving garbage', () => {
    const config = buildSourceNodeConfig({
      integrationId: 'int-1',
      method: 'POST',
      path: '/search',
      bodyText: '{oops',
    });
    expect(config).not.toHaveProperty('body');
    expect(config).not.toHaveProperty('bodyText');
  });

  it('strips body and bodyText for GET and normalizes missing method to GET', () => {
    const config = buildSourceNodeConfig({
      integrationId: 'int-1',
      path: '/items',
      body: { stale: true },
      bodyText: '{"stale": true}',
    });
    expect(config.method).toBe('GET');
    expect(config).not.toHaveProperty('body');
    expect(config).not.toHaveProperty('bodyText');
  });

  it('strips bodyText in graphql mode and keeps forcing POST', () => {
    const config = buildSourceNodeConfig({
      integrationId: 'int-1',
      mode: 'graphql',
      graphqlQuery: 'query { viewer { id } }',
      bodyText: '{"left": "over"}',
    });
    expect(config.method).toBe('POST');
    expect(config).not.toHaveProperty('bodyText');
  });
});

function buildChainedNodeConfig(transformConfig: Record<string, unknown>) {
  const { result } = renderHook(() =>
    useDataSourceBuilder({
      triggerType: 'schedule',
      triggerConfig: {},
      sourceType: 'http',
      sourceConfig: { integrationId: 'src-1', path: '/items' },
      transforms: [
        { id: 'chain-1', type: 'chained-source', config: transformConfig },
      ],
      sinks: [],
      confirmedSinkSchema: {},
    }),
  );
  const chainedNode = result.current
    .buildWorkflowNodes()
    .find(n => n.id === 'chain-1');
  if (!chainedNode) {
    throw new Error('chained node not built');
  }
  return chainedNode.data.config as Record<string, unknown>;
}

describe('useDataSourceBuilder chained-source http body serialization', () => {
  it('parses bodyText into body for a POST chained source and strips bodyText', () => {
    const config = buildChainedNodeConfig({
      backendType: 'http',
      integrationId: 'int-2',
      method: 'POST',
      path: '/lookup/{{id}}',
      bodyText: '{"userId": "{{id}}"}',
    });
    expect(config.method).toBe('POST');
    expect(config.body).toEqual({ userId: '{{id}}' });
    expect(config).not.toHaveProperty('bodyText');
  });

  it('resolves pathTemplate and pathParams into path for a chained source', () => {
    const config = buildChainedNodeConfig({
      backendType: 'http',
      integrationId: 'int-2',
      method: 'GET',
      pathTemplate: '/orgs/{org}/repos',
      pathParams: { org: 'roadie' },
    });
    expect(config.path).toBe('/orgs/roadie/repos');
  });

  it('drops the body for a GET chained source', () => {
    const config = buildChainedNodeConfig({
      backendType: 'http',
      integrationId: 'int-2',
      method: 'GET',
      path: '/items/{{id}}',
      bodyText: '{"stale": true}',
    });
    expect(config.method).toBe('GET');
    expect(config).not.toHaveProperty('body');
    expect(config).not.toHaveProperty('bodyText');
  });

  it('forces POST and strips bodyText for a graphql chained source', () => {
    const config = buildChainedNodeConfig({
      backendType: 'http',
      integrationId: 'int-2',
      mode: 'graphql',
      graphqlQuery: 'query { node(id: "{{id}}") { id } }',
      bodyText: '{"left": "over"}',
    });
    expect(config.method).toBe('POST');
    expect(config).not.toHaveProperty('bodyText');
  });

  it('leaves an AWS chained source untouched (no http normalization)', () => {
    const config = buildChainedNodeConfig({
      backendType: 'aws',
      integrationId: 'int-aws',
      mode: 'cloud-control',
      resourceType: 'AWS::S3::Bucket',
    });
    expect(config.mode).toBe('cloud-control');
    expect(config.resourceType).toBe('AWS::S3::Bucket');
    expect(config).not.toHaveProperty('method');
    expect(config).not.toHaveProperty('body');
  });
});

describe('useDataSourceBuilder flatmap transforms', () => {
  it('builds a transform-flatmap node carrying the expression and includeParent', () => {
    const { result } = renderHook(() =>
      useDataSourceBuilder({
        triggerType: 'schedule',
        triggerConfig: {},
        sourceType: 'datastore',
        sourceConfig: { datasourceId: 'ds-upstream' },
        transforms: [
          {
            id: 'transform-1',
            type: 'flatmap',
            config: {
              expression: '$._additionalData.repos',
              includeParent: true,
            },
          },
        ],
        sinks: [{ id: 'sink-1', type: 'datastore', config: {} }],
        confirmedSinkSchema: {},
      }),
    );

    const node = result.current
      .buildWorkflowNodes()
      .find(n => n.id === 'transform-1');

    expect(node).toMatchObject({
      type: 'transform-flatmap',
      data: {
        label: 'Flatmap',
        config: {
          expression: '$._additionalData.repos',
          includeParent: true,
        },
      },
    });
  });

  it('wires the flatmap step into the source → sink chain', () => {
    const { result } = renderHook(() =>
      useDataSourceBuilder({
        triggerType: null,
        triggerConfig: {},
        sourceType: 'datastore',
        sourceConfig: { datasourceId: 'ds-upstream' },
        transforms: [
          { id: 'transform-1', type: 'flatmap', config: { expression: 'x' } },
        ],
        sinks: [{ id: 'sink-1', type: 'datastore', config: {} }],
        confirmedSinkSchema: {},
      }),
    );

    expect(result.current.buildWorkflowEdges()).toEqual([
      expect.objectContaining({
        source: 'source-node',
        target: 'transform-1',
      }),
      expect.objectContaining({ source: 'transform-1', target: 'sink-1' }),
    ]);
  });
});
