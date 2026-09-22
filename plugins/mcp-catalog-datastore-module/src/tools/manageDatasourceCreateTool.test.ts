import { constructManageDatasourceCreateTool } from './manageDatasourceCreateTool';

const mockDiscovery = {
  getBaseUrl: vi.fn(),
  getExternalBaseUrl: vi.fn(),
};
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const INTEGRATIONS_URL = 'http://localhost:7007/api/integrations';
const WORKFLOW_URL = 'http://localhost:7007/api/catalog-workflow';

beforeEach(() => {
  vi.restoreAllMocks();
  mockDiscovery.getBaseUrl.mockImplementation(async (id: string) =>
    id === 'integrations' ? INTEGRATIONS_URL : WORKFLOW_URL,
  );
});

type Integration = {
  id: string;
  name: string;
  slug?: string;
  backendType?: string;
};

/**
 * Wires the fetch client to answer, in order: the integrations list, the
 * workflow existence check (404 = new), and the create/update write.
 */
function setupFetch(
  mockFetchClient: ReturnType<typeof vi.fn>,
  integrations: Integration[],
  { exists = false }: { exists?: boolean } = {},
) {
  mockFetchClient.mockImplementation(async (url: string, options?: any) => {
    if (url === INTEGRATIONS_URL) {
      return { ok: true, json: async () => ({ data: integrations }) };
    }
    // Workflow existence check (GET, no options) then the write.
    if (!options) {
      return exists
        ? { ok: true, json: async () => ({}) }
        : { ok: false, status: 404, statusText: 'Not Found' };
    }
    return { ok: true, json: async () => ({}) };
  });
}

/** Extracts the JSON body written to the workflow create/update call. */
function writtenWorkflowBody(mockFetchClient: ReturnType<typeof vi.fn>) {
  const writeCall = mockFetchClient.mock.calls.find(
    ([, options]) =>
      options && (options.method === 'POST' || options.method === 'PUT'),
  );
  if (!writeCall) {
    throw new Error('No workflow write call was made');
  }
  return JSON.parse(writeCall[1].body);
}

function sourceNode(body: any) {
  return body.nodes.find((n: any) => n.id === 'source-node');
}

describe('constructManageDatasourceCreateTool', () => {
  describe('construction', () => {
    it('creates tool with correct name and annotations', async () => {
      const tool = await constructManageDatasourceCreateTool(
        mockDiscovery as any,
        mockLogger as any,
      );

      expect(tool.name).toBe('manage_datasource_create');
      expect(tool.config.annotations).toEqual({
        title: 'Create or update a catalog datastore datasource',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    });
  });

  describe('callback', () => {
    let mockFetchClient: ReturnType<typeof vi.fn>;
    let callTool: (params: Record<string, unknown>) => Promise<any>;

    beforeEach(async () => {
      const tool = await constructManageDatasourceCreateTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      mockFetchClient = vi.fn();
      callTool = tool.cb({
        prePermissionedFetchClient: mockFetchClient,
        discovery: mockDiscovery,
      } as any) as any;
    });

    it('creates an HTTP datasource with an HTTP source node', async () => {
      setupFetch(mockFetchClient, [
        { id: 'gh-id', slug: 'github', name: 'GitHub', backendType: 'http' },
      ]);

      const result = await callTool({
        datasourceId: 'ds-1',
        datasourceName: 'GitHub Repos',
        integrationSlug: 'github',
        path: '/orgs/acme/repos',
        arrayExpression: '$',
        objectIdExpression: 'full_name',
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.backendType).toBe('http');

      const node = sourceNode(writtenWorkflowBody(mockFetchClient));
      expect(node.type).toBe('source-integration');
      expect(node.data.label).toBe('HTTP/REST');
      expect(node.data.config).toEqual({
        integrationId: 'gh-id',
        integrationName: 'GitHub',
        method: 'GET',
        path: '/orgs/acme/repos',
        headers: {},
        arrayExpression: '$',
        objectIdExpression: 'full_name',
      });
    });

    it('errors when an HTTP datasource is missing a path', async () => {
      setupFetch(mockFetchClient, [
        { id: 'gh-id', slug: 'github', name: 'GitHub', backendType: 'http' },
      ]);

      const result = await callTool({
        datasourceId: 'ds-1',
        datasourceName: 'GitHub Repos',
        integrationSlug: 'github',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('`path` is required');
    });

    it('creates an AWS cloud-control datasource', async () => {
      setupFetch(mockFetchClient, [
        { id: 'aws-1', slug: 'aws-prod', name: 'AWS Prod', backendType: 'aws' },
      ]);

      const result = await callTool({
        datasourceId: 'ds-aws',
        datasourceName: 'S3 Buckets',
        integrationSlug: 'aws-prod',
        awsMode: 'cloud-control',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.backendType).toBe('aws');

      const node = sourceNode(writtenWorkflowBody(mockFetchClient));
      expect(node.type).toBe('source-integration');
      expect(node.data.label).toBe('AWS');
      expect(node.data.config).toEqual({
        backendType: 'aws',
        integrationId: 'aws-1',
        mode: 'cloud-control',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      });
    });

    it('creates an AWS service-api datasource and infers the mode from `service`', async () => {
      setupFetch(mockFetchClient, [
        { id: 'aws-1', slug: 'aws-prod', name: 'AWS Prod', backendType: 'aws' },
      ]);

      const result = await callTool({
        datasourceId: 'ds-ec2',
        datasourceName: 'EC2 Instances',
        integrationSlug: 'aws-prod',
        service: 'ec2',
        operation: 'DescribeInstances',
        accountIds: ['123456789012'],
        arrayExpression: 'Reservations.Instances',
        objectIdExpression: 'InstanceId',
      });

      expect(result.isError).toBeUndefined();

      const node = sourceNode(writtenWorkflowBody(mockFetchClient));
      expect(node.data.label).toBe('AWS');
      expect(node.data.config).toEqual({
        backendType: 'aws',
        integrationId: 'aws-1',
        mode: 'service-api',
        service: 'ec2',
        operation: 'DescribeInstances',
        accountIds: ['123456789012'],
        arrayExpression: 'Reservations.Instances',
        objectIdExpression: 'InstanceId',
      });
    });

    it('supports dynamic accountSelection for AWS', async () => {
      setupFetch(mockFetchClient, [
        { id: 'aws-1', slug: 'aws-prod', name: 'AWS Prod', backendType: 'aws' },
      ]);

      const result = await callTool({
        datasourceId: 'ds-aws',
        datasourceName: 'All EC2',
        integrationSlug: 'aws-prod',
        awsMode: 'service-api',
        service: 'ec2',
        operation: 'DescribeInstances',
        accountSelection: {
          mode: 'all',
          requiredTags: [{ key: 'env', value: 'prod' }],
        },
      });

      expect(result.isError).toBeUndefined();
      const node = sourceNode(writtenWorkflowBody(mockFetchClient));
      expect(node.data.config.accountSelection).toEqual({
        mode: 'all',
        requiredTags: [{ key: 'env', value: 'prod' }],
      });
    });

    it('errors when an AWS datasource specifies no accounts', async () => {
      setupFetch(mockFetchClient, [
        { id: 'aws-1', slug: 'aws-prod', name: 'AWS Prod', backendType: 'aws' },
      ]);

      const result = await callTool({
        datasourceId: 'ds-aws',
        datasourceName: 'S3 Buckets',
        integrationSlug: 'aws-prod',
        awsMode: 'cloud-control',
        resourceType: 'AWS::S3::Bucket',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('accountIds');
    });

    it('errors when an AWS cloud-control datasource is missing resourceType', async () => {
      setupFetch(mockFetchClient, [
        { id: 'aws-1', slug: 'aws-prod', name: 'AWS Prod', backendType: 'aws' },
      ]);

      const result = await callTool({
        datasourceId: 'ds-aws',
        datasourceName: 'S3 Buckets',
        integrationSlug: 'aws-prod',
        awsMode: 'cloud-control',
        accountIds: ['123456789012'],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('resourceType');
    });

    it('updates an existing datasource via PUT', async () => {
      setupFetch(
        mockFetchClient,
        [
          {
            id: 'aws-1',
            slug: 'aws-prod',
            name: 'AWS Prod',
            backendType: 'aws',
          },
        ],
        { exists: true },
      );

      const result = await callTool({
        datasourceId: 'ds-aws',
        datasourceName: 'S3 Buckets',
        integrationSlug: 'aws-prod',
        awsMode: 'cloud-control',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
      });

      expect(result.isError).toBeUndefined();
      const patchCall = mockFetchClient.mock.calls.find(
        ([, options]) => options?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
    });

    it('errors when the integration is not found', async () => {
      setupFetch(mockFetchClient, []);

      const result = await callTool({
        datasourceId: 'ds-1',
        datasourceName: 'Nope',
        integrationSlug: 'missing',
        path: '/x',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Integration not found');
    });
  });
});
