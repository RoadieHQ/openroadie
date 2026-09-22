import { act, renderHook } from '@testing-library/react';
import type { WorkflowDefinition } from '../../api/workflow/workflow-client';
import { useDataSourceState } from './use-data-source-state';

function makeWorkflow(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id: 'ds-1',
    name: 'Test',
    description: '',
    version: 1,
    workflowType: 'data-ingestion',
    nodes: [
      {
        id: 'source-node',
        type: 'source-integration',
        position: { x: 0, y: 0 },
        data: {
          config: {
            integrationId: 'int-1',
            path: '/orgs/snyk/members',
            pathTemplate: '/orgs/{org}/members',
            pathParams: { org: 'snyk' },
            method: 'GET',
          },
        },
      },
      {
        id: 'transform-1',
        type: 'transform-filter',
        position: { x: 0, y: 100 },
        data: { config: { expression: '$' } },
      },
      {
        id: 'transform-2',
        type: 'transform-map',
        position: { x: 0, y: 200 },
        data: { config: { expression: '$' } },
      },
      {
        id: 'sink-1',
        type: 'sink-datastore',
        position: { x: 0, y: 300 },
        data: { config: { id_selector: 'id' } },
      },
    ],
    edges: [],
    enabled: false,
    createdBy: 'user-1',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    ...overrides,
  } as WorkflowDefinition;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDataSourceState dirty tracking', () => {
  it('starts with isDirty=false', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow(),
      }),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it('handleSourceConfigChange dirties (Source path parameter scenario)', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow(),
      }),
    );

    act(() => {
      result.current.handleSourceConfigChange('pathParams', { org: 'snyks' });
    });

    expect(result.current.isDirty).toBe(true);
    expect(result.current.sourceConfig.pathParams).toEqual({ org: 'snyks' });
  });

  it('handleUpdateTransform dirties when value changes (Filter / Map / Chained source)', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow(),
      }),
    );

    act(() => {
      result.current.handleUpdateTransform(
        'transform-1',
        'expression',
        '$.foo',
      );
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('handleUpdateTransform does NOT dirty when value is unchanged', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow(),
      }),
    );

    act(() => {
      result.current.handleUpdateTransform('transform-1', 'expression', '$');
    });

    expect(result.current.isDirty).toBe(false);
  });

  it.each<[string, (state: ReturnType<typeof useDataSourceState>) => void]>([
    [
      'handleUpdateSink (Store node scenario)',
      state => state.handleUpdateSink('sink-1', 'id_selector', 'uuid'),
    ],
    [
      'handleTriggerConfigChange',
      state => state.handleTriggerConfigChange('frequencyValue', 5),
    ],
    ['handleAddTransform', state => state.handleAddTransform('filter')],
    ['handleAddChainedSource', state => state.handleAddChainedSource()],
    [
      'handleDeleteTransform',
      state => state.handleDeleteTransform('transform-1'),
    ],
    ['markChanged (Integration select bypass)', state => state.markChanged()],
  ])('%s dirties', (_name, invoke) => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow(),
      }),
    );

    act(() => {
      invoke(result.current);
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('handleDeleteSink dirties when something is removed', () => {
    const workflow = makeWorkflow({
      nodes: [
        ...makeWorkflow().nodes,
        {
          id: 'sink-2',
          type: 'sink-datastore',
          position: { x: 0, y: 400 },
          data: { config: {} },
        },
      ],
    } as Partial<WorkflowDefinition>);

    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleDeleteSink('sink-2');
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('handleDeleteSink does NOT dirty when only one sink remains', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow(),
      }),
    );

    act(() => {
      result.current.handleDeleteSink('sink-1');
    });

    expect(result.current.isDirty).toBe(false);
  });

  it('clearIsDirty resets the flag (Save success scenario)', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow(),
      }),
    );

    act(() => {
      result.current.handleSourceConfigChange('method', 'POST');
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.clearIsDirty();
    });
    expect(result.current.isDirty).toBe(false);
  });

  it('successive edits keep isDirty=true', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow(),
      }),
    );

    act(() => {
      result.current.handleSourceConfigChange('pathParams', { org: 'a' });
    });
    act(() => {
      result.current.handleSourceConfigChange('pathParams', { org: 'b' });
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('uses operation metadata for seeded AWS service-api sources', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow({ nodes: [] }),
      }),
    );

    act(() => {
      result.current.setSourceType('aws');
      result.current.setSourceConfig({
        integrationId: 'aws-int',
        mode: 'service-api',
        accountSelection: { mode: 'all' },
        service: 'lambda',
        operation: 'ListFunctions',
        regions: ['eu-west-1'],
      });
    });

    expect(result.current.isSourceConfigured).toBe(true);
    expect(result.current.sourceMissingReason).toBeUndefined();
  });

  it('detects a source-datastore node and treats it as configured when a datasource is chosen (sc-33950)', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow({
          nodes: [
            {
              id: 'source-node',
              type: 'source-datastore',
              position: { x: 0, y: 0 },
              data: {
                label: 'Upstream',
                config: {
                  datasourceId: 'ds-upstream',
                  datasourceName: 'GitHub Users',
                },
              },
            },
          ],
        }),
      }),
    );

    expect(result.current.sourceType).toBe('datastore');
    expect(result.current.sourceConfig).toEqual({
      datasourceId: 'ds-upstream',
      datasourceName: 'GitHub Users',
    });
    expect(result.current.isSourceConfigured).toBe(true);
    expect(result.current.sourceMissingReason).toBeUndefined();
  });

  it('flags a datastore source without a datasource as not configured', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow({ nodes: [] }),
      }),
    );

    act(() => {
      result.current.setSourceType('datastore');
      result.current.setSourceConfig({});
    });

    expect(result.current.isSourceConfigured).toBe(false);
    expect(result.current.sourceMissingReason).toBe('Select a data source');
  });

  it('reports the first missing field for AWS service-api sources', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow({ nodes: [] }),
      }),
    );

    act(() => {
      result.current.setSourceType('aws');
      result.current.setSourceConfig({
        integrationId: 'aws-int',
        mode: 'service-api',
        service: 'lambda',
        operation: 'ListFunctions',
        regions: ['eu-west-1'],
        path: '/2015-03-31/functions/',
        arrayExpression: 'Functions',
      });
    });

    expect(result.current.isSourceConfigured).toBe(false);
    expect(result.current.sourceMissingReason).toBe(
      'Select at least one AWS account',
    );
  });

  it('treats AWS configured-accounts sources as configured without account targets', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow({ nodes: [] }),
      }),
    );

    act(() => {
      result.current.setSourceType('aws');
      result.current.setSourceConfig({
        integrationId: 'aws-int',
        mode: 'configured-accounts',
      });
    });

    expect(result.current.isSourceConfigured).toBe(true);
    expect(result.current.sourceMissingReason).toBeUndefined();
  });

  it('treats AWS select-all account selection as configured', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow({ nodes: [] }),
      }),
    );

    act(() => {
      result.current.setSourceType('aws');
      result.current.setSourceConfig({
        integrationId: 'aws-int',
        mode: 'cloud-control',
        accountSelection: {
          mode: 'all',
          excludedAccountIds: ['123456789012'],
        },
        resourceType: 'AWS::S3::Bucket',
      });
    });

    expect(result.current.isSourceConfigured).toBe(true);
    expect(result.current.sourceMissingReason).toBeUndefined();
  });

  it('progressively auto-updates the default draft name', () => {
    const workflow = makeWorkflow({
      name: 'Data Source May 1, 10:33:00',
      nodes: [],
    });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange('integrationName', 'GitHub');
    });
    expect(result.current.workflowName).toBe(
      'GitHub Data Source May 1, 10:33:00',
    );

    act(() => {
      result.current.handleSourceConfigChange(
        'pathTemplate',
        '/orgs/{org}/members',
      );
    });
    expect(result.current.workflowName).toBe('GitHub Members');
  });

  it('uses AWS resource type for auto-updated draft names', () => {
    const workflow = makeWorkflow({
      name: 'Data Source May 1, 10:33:00',
      nodes: [],
    });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange('integrationName', 'AWS');
      result.current.handleSourceConfigChange(
        'resourceType',
        'AWS::S3::Bucket',
      );
    });

    expect(result.current.workflowName).toBe('AWS S3 Bucket');
  });

  it('uses AWS service and operation for auto-updated draft names', () => {
    const workflow = makeWorkflow({
      name: 'Data Source May 1, 10:33:00',
      nodes: [],
    });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange('integrationName', 'AWS');
      result.current.handleSourceConfigChange('mode', 'service-api');
      result.current.handleSourceConfigChange('service', 'lambda');
      result.current.handleSourceConfigChange('operation', 'ListFunctions');
    });

    expect(result.current.workflowName).toBe('AWS Lambda Functions');
  });

  it('updates draft name when switching back to cloud-control resource types', () => {
    const workflow = makeWorkflow({
      name: 'Data Source May 1, 10:33:00',
      nodes: [],
    });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange('integrationName', 'AWS');
      result.current.handleSourceConfigChange('mode', 'service-api');
      result.current.handleSourceConfigChange('service', 'lambda');
      result.current.handleSourceConfigChange('operation', 'ListFunctions');
    });
    expect(result.current.workflowName).toBe('AWS Lambda Functions');

    act(() => {
      result.current.handleSourceConfigChange('mode', 'cloud-control');
      result.current.handleSourceConfigChange(
        'resourceType',
        'AWS::S3::Bucket',
      );
    });
    expect(result.current.workflowName).toBe('AWS S3 Bucket');

    act(() => {
      result.current.handleSourceConfigChange('resourceType', 'AWS::EC2::VPC');
    });
    expect(result.current.workflowName).toBe('AWS EC2 VPC');
  });

  it('stops auto-updating after a manual rename', () => {
    const workflow = makeWorkflow({
      name: 'Data Source May 1, 10:33:00',
      nodes: [],
    });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange('integrationName', 'GitHub');
    });
    act(() => {
      result.current.setWorkflowName('Custom name');
    });
    act(() => {
      result.current.handleSourceConfigChange(
        'pathTemplate',
        '/orgs/{org}/members',
      );
    });

    expect(result.current.workflowName).toBe('Custom name');
  });

  it('does not auto-update existing workflow names', () => {
    const workflow = makeWorkflow({ name: 'GitHub Members' });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange(
        'pathTemplate',
        '/orgs/{org}/teams',
      );
    });

    expect(result.current.workflowName).toBe('GitHub Members');
  });

  it('uses chained source integration and path for flatten mode', () => {
    const workflow = makeWorkflow({
      name: 'Data Source May 1, 10:33:00',
      nodes: [],
    });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange('integrationName', 'GitHub');
      result.current.handleSourceConfigChange(
        'pathTemplate',
        '/orgs/{org}/members',
      );
      result.current.handleAddChainedSource();
    });

    const chainedSourceId = result.current.transforms[0].id;

    act(() => {
      result.current.handleUpdateTransform(
        chainedSourceId,
        'integrationName',
        'PagerDuty',
      );
      result.current.handleUpdateTransform(
        chainedSourceId,
        'pathTemplate',
        '/services',
      );
      result.current.handleUpdateTransform(
        chainedSourceId,
        'resultMode',
        'flatten',
      );
    });

    expect(result.current.workflowName).toBe('PagerDuty Services');
  });

  it('uses chained AWS resource type for flatten mode', () => {
    const workflow = makeWorkflow({
      name: 'Data Source May 1, 10:33:00',
      nodes: [],
    });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange('integrationName', 'GitHub');
      result.current.handleSourceConfigChange(
        'pathTemplate',
        '/orgs/{org}/members',
      );
      result.current.handleAddChainedSource();
    });

    const chainedSourceId = result.current.transforms[0].id;

    act(() => {
      result.current.handleUpdateTransform(
        chainedSourceId,
        'integrationName',
        'AWS',
      );
      result.current.handleUpdateTransform(
        chainedSourceId,
        'resourceType',
        'AWS::EC2::VPC',
      );
      result.current.handleUpdateTransform(
        chainedSourceId,
        'resultMode',
        'flatten',
      );
    });

    expect(result.current.workflowName).toBe('AWS EC2 VPC');
  });

  it('appends enriched when a chained source enriches results', () => {
    const workflow = makeWorkflow({
      name: 'Data Source May 1, 10:33:00',
      nodes: [],
    });
    const { result } = renderHook(() => useDataSourceState({ workflow }));

    act(() => {
      result.current.handleSourceConfigChange('integrationName', 'GitHub');
      result.current.handleSourceConfigChange(
        'pathTemplate',
        '/orgs/{org}/members',
      );
      result.current.handleAddChainedSource();
    });

    expect(result.current.workflowName).toBe('GitHub Members Enriched');
  });
});

describe('useDataSourceState POST body gating', () => {
  function makePostWorkflow() {
    return makeWorkflow({
      nodes: [
        {
          id: 'source-node',
          type: 'source-integration',
          position: { x: 0, y: 0 },
          data: {
            label: 'Source',
            config: {
              integrationId: 'int-1',
              path: '/search',
              method: 'POST',
            },
          },
        },
      ],
    });
  }

  it('is configured for POST with no body', () => {
    const { result } = renderHook(() =>
      useDataSourceState({ workflow: makePostWorkflow() }),
    );
    expect(result.current.isSourceConfigured).toBe(true);
  });

  it('is not configured while the body JSON is invalid', () => {
    const { result } = renderHook(() =>
      useDataSourceState({ workflow: makePostWorkflow() }),
    );
    act(() => {
      result.current.handleSourceConfigChange('bodyText', '{oops');
    });
    expect(result.current.isSourceConfigured).toBe(false);
    expect(result.current.sourceMissingReason).toBe(
      'Fix the request body JSON',
    );
  });

  it('recovers once the body JSON parses', () => {
    const { result } = renderHook(() =>
      useDataSourceState({ workflow: makePostWorkflow() }),
    );
    act(() => {
      result.current.handleSourceConfigChange('bodyText', '{"a": 1}');
    });
    expect(result.current.isSourceConfigured).toBe(true);
    expect(result.current.sourceMissingReason).toBeUndefined();
  });
});

describe('useDataSourceState header hydration', () => {
  function makeWorkflowWithHeaders(
    chainedConfig: Record<string, unknown>,
  ): WorkflowDefinition {
    return makeWorkflow({
      nodes: [
        {
          id: 'source-node',
          type: 'source-integration',
          position: { x: 0, y: 0 },
          data: {
            label: 'HTTP/REST',
            config: {
              integrationId: 'int-1',
              path: '/orgs/snyk/members',
              method: 'GET',
              headers: { 'X-Api-Version': '2024-01-01' },
            },
          },
        },
        {
          id: 'chained-source-1',
          type: 'source-chained',
          position: { x: 0, y: 100 },
          data: { label: 'Chained Source', config: chainedConfig },
        },
      ],
    });
  }

  it('converts a saved header map on the source into editor pairs', () => {
    const { result } = renderHook(() =>
      useDataSourceState({ workflow: makeWorkflowWithHeaders({}) }),
    );

    expect(result.current.sourceConfig.headers).toEqual([
      { key: 'X-Api-Version', value: '2024-01-01' },
    ]);
  });

  it('converts a saved header map on a chained source into editor pairs (sc-34494)', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflowWithHeaders({
          integrationId: 'int-1',
          path: '/users/{{id}}',
          method: 'GET',
          headers: {
            Authorization: 'Bearer token',
            Accept: 'application/json',
          },
        }),
      }),
    );

    const chained = result.current.transforms.find(
      t => t.id === 'chained-source-1',
    );
    expect(chained?.type).toBe('chained-source');
    expect(chained?.config.headers).toEqual([
      { key: 'Authorization', value: 'Bearer token' },
      { key: 'Accept', value: 'application/json' },
    ]);
  });

  it('leaves chained-source headers alone when already stored as pairs', () => {
    const headers = [{ key: 'Accept', value: 'application/json' }];
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflowWithHeaders({ integrationId: 'int-1', headers }),
      }),
    );

    expect(
      result.current.transforms.find(t => t.id === 'chained-source-1')?.config
        .headers,
    ).toBe(headers);
  });

  it('does not add an empty headers array to a chained source without headers', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflowWithHeaders({
          backendType: 'aws',
          mode: 'cloud-control',
          resourceType: 'AWS::S3::Bucket',
        }),
      }),
    );

    const chained = result.current.transforms.find(
      t => t.id === 'chained-source-1',
    );
    expect(chained?.config).not.toHaveProperty('headers');
  });
});

describe('useDataSourceState flatmap steps', () => {
  it('hydrates a transform-flatmap node as a flatmap pipeline step', () => {
    const { result } = renderHook(() =>
      useDataSourceState({
        workflow: makeWorkflow({
          nodes: [
            {
              id: 'source-node',
              type: 'source-datastore',
              position: { x: 0, y: 0 },
              data: {
                label: 'Source',
                config: { datasourceId: 'ds-upstream' },
              },
            },
            {
              id: 'transform-1',
              type: 'transform-flatmap',
              position: { x: 0, y: 100 },
              data: {
                label: 'Flatmap',
                config: { expression: 'repos', includeParent: true },
              },
            },
          ],
        }),
      }),
    );

    expect(result.current.transforms).toEqual([
      {
        id: 'transform-1',
        type: 'flatmap',
        config: { expression: 'repos', includeParent: true },
      },
    ]);
  });

  it('adds a flatmap step at the requested position and dirties the editor', () => {
    const { result } = renderHook(() =>
      useDataSourceState({ workflow: makeWorkflow() }),
    );

    act(() => {
      result.current.handleAddTransform('flatmap', 1);
    });

    expect(result.current.transforms.map(t => t.type)).toEqual([
      'filter',
      'flatmap',
      'map',
    ]);
    expect(result.current.isDirty).toBe(true);
  });
});
