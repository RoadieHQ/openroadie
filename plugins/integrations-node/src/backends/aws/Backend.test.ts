import { beforeEach, describe, expect, it, vi } from 'vitest';

const jest = vi;

import { AwsBackend } from './Backend';
import {
  AWS_READ_ONLY_SESSION_POLICY_ARN,
  createStrictAwsAssumeRolePolicy,
  deriveExternalId,
} from './assume-role-policy';
import { Integration } from '../../index';
import {
  AwsRequestApiOptions,
  AwsOrganizationsAccountPreviewOptions,
  AwsRequestPagesOptions,
  AwsRequestResourceOptions,
} from './index';

const {
  mockSend,
  MockCloudControlClient,
  mockFromTemporaryCredentials,
  mockFromNodeProviderChain,
  mockHttpsRequest,
} = vi.hoisted(() => ({
  mockSend: vi.fn(),
  MockCloudControlClient: vi.fn(),
  mockFromTemporaryCredentials: vi.fn().mockReturnValue(() =>
    Promise.resolve({
      accessKeyId: 'mock-access-key',
      secretAccessKey: 'mock-secret-key',
    }),
  ),
  mockFromNodeProviderChain: vi.fn().mockReturnValue(() =>
    Promise.resolve({
      accessKeyId: 'mock-access-key',
      secretAccessKey: 'mock-secret-key',
    }),
  ),
  mockHttpsRequest: vi.fn(),
}));

const voidLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => voidLogger,
} as any;

function mockJsonResponse(body: unknown, headers?: Record<string, string>) {
  const headerMap = new Map(
    Object.entries({
      'content-type': 'application/json',
      ...headers,
    }),
  );
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
      forEach: (callback: (value: string, key: string) => void) => {
        headerMap.forEach((value, key) => callback(value, key));
      },
    },
  } as Response;
}

function mockTextResponse(
  body: string,
  options?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  },
) {
  const headerMap = new Map(
    Object.entries({
      'content-type': 'text/plain',
      ...options?.headers,
    }),
  );
  const status = options?.status ?? 200;
  const statusText = options?.statusText ?? 'OK';
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(body),
    text: async () => body,
    headers: {
      get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
      forEach: (callback: (value: string, key: string) => void) => {
        headerMap.forEach((value, key) => callback(value, key));
      },
    },
  } as Response;
}

function queueHttpsTextResponse(
  body: string,
  options?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  },
) {
  const status = options?.status ?? 200;
  const statusText = options?.statusText ?? 'OK';
  const headers = options?.headers ?? {};

  mockHttpsRequest.mockImplementationOnce(
    (_requestOptions: unknown, callback: (response: unknown) => void) => {
      let onData: ((chunk: Buffer) => void) | undefined;
      let onEnd: (() => void) | undefined;
      let onError: ((error: Error) => void) | undefined;

      const response = {
        statusCode: status,
        statusMessage: statusText,
        headers,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'data') {
            onData = handler as (chunk: Buffer) => void;
          }
          if (event === 'end') {
            onEnd = handler as () => void;
          }
          return response;
        }),
      };

      const request = {
        writtenBody: '',
        write: vi.fn((chunk: string | Buffer) => {
          request.writtenBody += String(chunk);
        }),
        end: vi.fn(() => {
          callback(response);
          if (body) {
            onData?.(Buffer.from(body));
          }
          onEnd?.();
        }),
        on: vi.fn((event: string, handler: (error: Error) => void) => {
          if (event === 'error') {
            onError = handler;
          }
          return request;
        }),
        destroy: vi.fn((error?: Error) => {
          if (error) {
            onError?.(error);
          }
        }),
      };

      return request;
    },
  );
}

vi.mock('@aws-sdk/client-cloudcontrol', () => {
  class MockCloudControlClientClass {
    send = mockSend;

    constructor(input: unknown) {
      MockCloudControlClient(input);
    }
  }

  class ListResourcesCommandClass {
    _type = 'ListResources';

    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }

  class GetResourceCommandClass {
    _type = 'GetResource';

    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }

  class DeleteResourceCommandClass {
    _type = 'DeleteResource';

    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }

  class UpdateResourceCommandClass {
    _type = 'UpdateResource';

    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }

  class CreateResourceCommandClass {
    _type = 'CreateResource';

    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }

  return {
    CloudControlClient: MockCloudControlClientClass,
    ListResourcesCommand: ListResourcesCommandClass,
    GetResourceCommand: GetResourceCommandClass,
    DeleteResourceCommand: DeleteResourceCommandClass,
    UpdateResourceCommand: UpdateResourceCommandClass,
    CreateResourceCommand: CreateResourceCommandClass,
    ThrottlingException: class ThrottlingException extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ThrottlingException';
      }
    },
  };
});

vi.mock('@aws-sdk/credential-providers', () => ({
  fromTemporaryCredentials: mockFromTemporaryCredentials,
  fromNodeProviderChain: mockFromNodeProviderChain,
}));

vi.mock('node:https', () => ({
  request: mockHttpsRequest,
}));

describe('AwsBackend', () => {
  const mockIntegration: Integration = {
    id: 'aws-test',
    name: 'aws-integration',
    slug: 'aws-integration',
    type: 'infrastructure',
    host: '',
    authType: 'none',
    authConfig: null,
    requestsPerHour: 36000,
    backendType: 'aws',
    config: {
      profiles: {},
    },
    readyForCurrentScope: true,
    createdBy: 'test-user',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpsRequest.mockReset();
  });

  describe('requestPages', () => {
    it('reuses cached CloudControl clients for scope-less callers', async () => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }
      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(MockCloudControlClient).toHaveBeenCalledTimes(1);
    });

    it('separates cached CloudControl clients by scopeId', async () => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const baseOptions: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      };

      for await (const page of backend.requestPages(mockIntegration, {
        ...baseOptions,
        scopeId: 'acme',
      })) {
        void page;
      }
      for await (const page of backend.requestPages(mockIntegration, {
        ...baseOptions,
        scopeId: 'globex',
      })) {
        void page;
      }
      for await (const page of backend.requestPages(mockIntegration, {
        ...baseOptions,
        scopeId: '',
      })) {
        void page;
      }
      for await (const page of backend.requestPages(mockIntegration, {
        ...baseOptions,
      })) {
        void page;
      }

      expect(MockCloudControlClient).toHaveBeenCalledTimes(3);
    });

    it('yields pages of resources', async () => {
      mockSend
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'bucket-1' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ BucketName: 'bucket-1' }),
          },
        });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toHaveLength(1);
      expect(pages[0].items[0]).toMatchObject({
        id: 'bucket-1',
        identifier: 'bucket-1',
        resourceType: 'AWS::S3::Bucket',
      });
    });

    it('calls beforeRequest before each API call', async () => {
      const callOrder: string[] = [];
      const beforeRequest = vi.fn().mockImplementation(async () => {
        callOrder.push('beforeRequest');
      });

      mockSend.mockImplementation(async (cmd: { _type: string }) => {
        callOrder.push(`send:${cmd._type}`);
        if (cmd._type === 'ListResources') {
          return {
            ResourceDescriptions: [{ Identifier: 'res-1' }],
            NextToken: undefined,
          };
        }
        return {
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'res-1' }),
          },
        };
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::EC2::Instance',
        accountIds: ['123456789012'],
        regions: ['us-west-2'],
        beforeRequest,
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(beforeRequest).toHaveBeenCalledTimes(2);
      expect(callOrder).toEqual([
        'beforeRequest',
        'send:ListResources',
        'beforeRequest',
        'send:GetResource',
      ]);
    });

    it('calls onRequestLog for ListResources and GetResource', async () => {
      const onRequestLog = vi.fn();

      mockSend
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'res-1' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'res-1' }),
          },
        });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::Lambda::Function',
        accountIds: ['123456789012'],
        regions: ['eu-west-1'],
        onRequestLog,
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(onRequestLog).toHaveBeenCalledTimes(2);
      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'ListResources',
          target: 'AWS::Lambda::Function [account:123456789012]',
          responseBody: expect.objectContaining({
            count: 1,
          }),
        }),
      );
      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'GetResource',
          target: 'AWS::Lambda::Function/res-1',
        }),
      );
    });

    it('handles pagination with NextToken', async () => {
      mockSend
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'res-1' }],
          NextToken: 'token-abc',
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'res-1' }),
          },
        })
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'res-2' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'res-2' }),
          },
        });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items[0]).toMatchObject({ id: 'res-1' });
      expect(pages[1].items[0]).toMatchObject({ id: 'res-2' });
    });

    it('throws on abort signal before ListResources', async () => {
      const controller = new AbortController();
      controller.abort();

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
        signal: controller.signal,
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow('Operation cancelled');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('throws on abort signal between GetResource calls', async () => {
      const controller = new AbortController();

      let sendCallCount = 0;
      mockSend.mockImplementation(async () => {
        sendCallCount++;
        if (sendCallCount === 1) {
          return {
            ResourceDescriptions: [
              { Identifier: 'res-1' },
              { Identifier: 'res-2' },
            ],
            NextToken: undefined,
          };
        }
        if (sendCallCount === 2) {
          controller.abort();
          return {
            ResourceDescription: {
              Properties: JSON.stringify({ Name: 'res-1' }),
            },
          };
        }
        return {
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'res-2' }),
          },
        };
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
        signal: controller.signal,
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow('Operation cancelled');

      expect(sendCallCount).toBe(2);
    });

    it('gracefully handles GetResource failure with empty properties', async () => {
      const onRequestLog = vi.fn();

      mockSend
        .mockResolvedValueOnce({
          ResourceDescriptions: [
            { Identifier: 'ok-res' },
            { Identifier: 'bad-res' },
          ],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'ok-res' }),
          },
        })
        .mockRejectedValueOnce(new Error('Access Denied'));

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::EC2::Instance',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
        onRequestLog,
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toHaveLength(2);
      expect(pages[0].items[0]).toMatchObject({
        id: 'ok-res',
        properties: { Name: 'ok-res' },
      });
      expect(pages[0].items[1]).toMatchObject({
        id: 'bad-res',
        properties: {},
      });

      const errorLog = onRequestLog.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { operation: string }).operation === 'GetResource' &&
          (call[0] as { error?: string }).error,
      );
      if (!errorLog) {
        throw new Error('expected a GetResource log entry carrying an error');
      }
      expect(errorLog[0].error).toBe('Access Denied');
      expect(errorLog[0].status).toBeUndefined();
    });

    it('fetches resources across multiple accounts', async () => {
      mockSend
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'bucket-acct1' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ BucketName: 'bucket-acct1' }),
          },
        })
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'bucket-acct2' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ BucketName: 'bucket-acct2' }),
          },
        });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['111111111111', '222222222222'],
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items[0]).toMatchObject({
        accountId: '111111111111',
        id: 'bucket-acct1',
      });
      expect(pages[1].items[0]).toMatchObject({
        accountId: '222222222222',
        id: 'bucket-acct2',
      });
    });

    it('continues cloud-control requests when one account fails', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Access denied for account one'))
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'bucket-acct2' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ BucketName: 'bucket-acct2' }),
          },
        });

      const warn = vi.fn();
      const logger = {
        ...voidLogger,
        warn,
      } as any;
      logger.child = () => logger;

      const backend = new AwsBackend({ logger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['111111111111', '222222222222'],
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items[0]).toMatchObject({
        accountId: '222222222222',
        id: 'bucket-acct2',
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Skipping AWS Cloud Control request for AWS::S3::Bucket in account 111111111111 (us-east-1)',
        ),
      );
    });

    it('throws when all cloud-control accounts fail', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Access denied for account one'))
        .mockRejectedValueOnce(new Error('Access denied for account two'));

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['111111111111', '222222222222'],
        regions: ['us-east-1'],
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow(
        'All AWS Cloud Control account requests failed (2 total). First error: AWS CloudControl request failed for AWS::S3::Bucket in account 111111111111 (us-east-1): Error: Access denied for account one',
      );
    });

    it('fetches resources across multiple regions', async () => {
      mockSend
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'res-east' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'res-east' }),
          },
        })
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'res-west' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'res-west' }),
          },
        });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::EC2::Instance',
        accountIds: ['123456789012'],
        regions: ['us-east-1', 'us-west-2'],
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items[0]).toMatchObject({
        region: 'us-east-1',
        id: 'res-east',
      });
      expect(pages[1].items[0]).toMatchObject({
        region: 'us-west-2',
        id: 'res-west',
      });

      expect(MockCloudControlClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'us-east-1' }),
      );
      expect(MockCloudControlClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'us-west-2' }),
      );
    });

    it('assumes role with custom roleName and externalId from integration config', async () => {
      mockSend
        .mockResolvedValueOnce({
          ResourceDescriptions: [{ Identifier: 'res-1' }],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          ResourceDescription: {
            Properties: JSON.stringify({ Name: 'res-1' }),
          },
        });

      const backend = new AwsBackend({ logger: voidLogger });

      const integrationWithProfiles: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'MyCustomRole',
              externalId: 'ext-123',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      };

      for await (const page of backend.requestPages(
        integrationWithProfiles,
        options,
      )) {
        void page;
      }

      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith({
        params: {
          RoleArn: 'arn:aws:iam::123456789012:role/MyCustomRole',
          ExternalId: 'ext-123',
          RoleSessionName: 'integration-aws-test',
        },
        clientConfig: { region: 'us-east-1' },
      });

      expect(MockCloudControlClient).toHaveBeenCalledWith({
        credentials: expect.any(Function),
        region: 'us-east-1',
      });
    });

    it('includes scopeId in assumed role session names when provided', async () => {
      mockSend.mockResolvedValueOnce({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const integrationWithProfiles: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'MyCustomRole',
              externalId: 'ext-123',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
        scopeId: 'acme',
      };

      for await (const page of backend.requestPages(
        integrationWithProfiles,
        options,
      )) {
        void page;
      }

      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith({
        params: {
          RoleArn: 'arn:aws:iam::123456789012:role/MyCustomRole',
          ExternalId: 'ext-123',
          RoleSessionName: 'integration-aws-test-acme',
        },
        clientConfig: { region: 'us-east-1' },
      });
    });

    it('uses full ARN when roleName starts with arn:', async () => {
      mockSend.mockResolvedValueOnce({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const fullArn = 'arn:aws:iam::999999999999:role/SomeOtherRole';
      const integrationWithArn: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: fullArn,
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      };

      for await (const page of backend.requestPages(
        integrationWithArn,
        options,
      )) {
        void page;
      }

      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: fullArn,
          }),
        }),
      );
    });

    it('uses default credentials when no roleName configured', async () => {
      mockSend.mockResolvedValueOnce({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(mockFromTemporaryCredentials).not.toHaveBeenCalled();
      expect(MockCloudControlClient).toHaveBeenCalledWith({
        credentials: expect.any(Function),
        region: 'us-east-1',
      });
    });

    it('falls back to us-east-1 when regions not specified and profile has no region', async () => {
      mockSend.mockResolvedValueOnce({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(MockCloudControlClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'us-east-1' }),
      );
    });

    it('falls back to the profile region when source regions not specified', async () => {
      mockSend.mockResolvedValueOnce({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const integrationWithProfileRegion: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              region: 'eu-west-1',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
      };

      for await (const page of backend.requestPages(
        integrationWithProfileRegion,
        options,
      )) {
        void page;
      }

      expect(MockCloudControlClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'eu-west-1' }),
      );
    });

    it('prefers source regions over the profile region when both are set', async () => {
      mockSend.mockResolvedValueOnce({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const integrationWithProfileRegion: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              region: 'eu-west-1',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::S3::Bucket',
        accountIds: ['123456789012'],
        regions: ['ap-south-1'],
      };

      for await (const page of backend.requestPages(
        integrationWithProfileRegion,
        options,
      )) {
        void page;
      }

      expect(MockCloudControlClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'ap-south-1' }),
      );
    });

    it('lists AWS::OpenSearchService::Domain via the OpenSearch HTTP API', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        mockJsonResponse({
          DomainNames: [
            { DomainName: 'domain-1', EngineType: 'OpenSearch' },
            { DomainName: 'domain-2', EngineType: 'Elasticsearch' },
          ],
        }),
      );

      mockSend.mockRejectedValue(
        new Error('ResourceType not supported by Cloud Control'),
      );

      const backend = new AwsBackend({ logger: voidLogger });

      const integrationWithProfile: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-pages',
        resourceType: 'AWS::OpenSearchService::Domain',
        accountIds: ['123456789012'],
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfile,
        options,
      )) {
        pages.push(page);
      }

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe(
        'https://es.us-east-1.amazonaws.com/2015-01-01/domain',
      );
      expect((calledInit as RequestInit | undefined)?.method).toBe('GET');

      const listResourcesCalls = mockSend.mock.calls.filter(
        ([cmd]) => (cmd as { _type?: string })?._type === 'ListResources',
      );
      expect(listResourcesCalls).toHaveLength(0);

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toHaveLength(2);
      expect(pages[0].items[0]).toMatchObject({
        id: 'domain-1',
        identifier: 'domain-1',
        resourceType: 'AWS::OpenSearchService::Domain',
        accountId: '123456789012',
        region: 'us-east-1',
      });
      expect(pages[0].items[1]).toMatchObject({
        id: 'domain-2',
        identifier: 'domain-2',
      });

      fetchSpy.mockRestore();
    });

    it('paginates AWS service API requests with cursor pagination', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          mockJsonResponse({
            Functions: [
              {
                FunctionArn:
                  'arn:aws:lambda:us-east-1:123456789012:function:first',
              },
            ],
            NextMarker: 'next-page',
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            Functions: [
              {
                FunctionArn:
                  'arn:aws:lambda:us-east-1:123456789012:function:second',
              },
            ],
          }),
        );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfile: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['123456789012'],
        service: 'lambda',
        operation: 'ListFunctions',
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfile,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items).toEqual([
        {
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:first',
          _aws: { accountId: '123456789012', region: 'us-east-1' },
        },
      ]);
      expect(pages[1].items).toEqual([
        {
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:second',
          _aws: { accountId: '123456789012', region: 'us-east-1' },
        },
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/',
      );
      expect(fetchSpy.mock.calls[1][0]).toBe(
        'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/?Marker=next-page',
      );

      fetchSpy.mockRestore();
    });

    it('omits request bodies for GET AWS service API requests', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({
          clusters: ['cluster-a'],
        }),
      );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfile: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['123456789012'],
        service: 'eks',
        operation: 'ListClusters',
        regions: ['us-east-1'],
        body: '',
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfile,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toEqual([
        {
          value: 'cluster-a',
          _aws: { accountId: '123456789012', region: 'us-east-1' },
        },
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://eks.us-east-1.amazonaws.com/clusters',
      );
      expect(
        (fetchSpy.mock.calls[0][1] as RequestInit | undefined)?.body,
      ).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it('fans out AWS service API requests across multiple accounts', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          mockJsonResponse({
            Functions: [
              {
                FunctionArn:
                  'arn:aws:lambda:us-east-1:111111111111:function:first',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            Functions: [
              {
                FunctionArn:
                  'arn:aws:lambda:us-east-1:222222222222:function:second',
              },
            ],
          }),
        );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfiles: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '111111111111': {
              accountId: '111111111111',
              roleName: 'AccountOneRole',
            },
            '222222222222': {
              accountId: '222222222222',
              roleName: 'AccountTwoRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['111111111111', '222222222222'],
        service: 'lambda',
        operation: 'ListFunctions',
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfiles,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items).toEqual([
        {
          FunctionArn: 'arn:aws:lambda:us-east-1:111111111111:function:first',
          _aws: { accountId: '111111111111', region: 'us-east-1' },
        },
      ]);
      expect(pages[1].items).toEqual([
        {
          FunctionArn: 'arn:aws:lambda:us-east-1:222222222222:function:second',
          _aws: { accountId: '222222222222', region: 'us-east-1' },
        },
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: 'arn:aws:iam::111111111111:role/AccountOneRole',
          }),
        }),
      );
      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: 'arn:aws:iam::222222222222:role/AccountTwoRole',
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('continues service API requests when one account fails', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          mockTextResponse(
            `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse>
  <Error>
    <Code>AccessDenied</Code>
    <Message>Denied for account one</Message>
  </Error>
</ErrorResponse>`,
            {
              status: 403,
              statusText: 'Forbidden',
              headers: { 'content-type': 'application/xml' },
            },
          ),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            Functions: [
              {
                FunctionArn:
                  'arn:aws:lambda:us-east-1:222222222222:function:second',
              },
            ],
          }),
        );

      const warn = vi.fn();
      const logger = {
        ...voidLogger,
        warn,
      } as any;
      logger.child = () => logger;

      const backend = new AwsBackend({ logger });
      const integrationWithProfiles: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '111111111111': {
              accountId: '111111111111',
              roleName: 'AccountOneRole',
            },
            '222222222222': {
              accountId: '222222222222',
              roleName: 'AccountTwoRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['111111111111', '222222222222'],
        service: 'lambda',
        operation: 'ListFunctions',
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfiles,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toEqual([
        {
          FunctionArn: 'arn:aws:lambda:us-east-1:222222222222:function:second',
          _aws: { accountId: '222222222222', region: 'us-east-1' },
        },
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Skipping AWS Service API request for lambda:ListFunctions in account 111111111111 (us-east-1) (HTTP 403)',
        ),
      );

      fetchSpy.mockRestore();
    });

    it('throws when all service API accounts fail', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          mockTextResponse(
            `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse>
  <Error>
    <Code>AccessDenied</Code>
    <Message>Denied for account one</Message>
  </Error>
</ErrorResponse>`,
            {
              status: 403,
              statusText: 'Forbidden',
              headers: { 'content-type': 'application/xml' },
            },
          ),
        )
        .mockResolvedValueOnce(
          mockTextResponse(
            `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse>
  <Error>
    <Code>AccessDenied</Code>
    <Message>Denied for account two</Message>
  </Error>
</ErrorResponse>`,
            {
              status: 403,
              statusText: 'Forbidden',
              headers: { 'content-type': 'application/xml' },
            },
          ),
        );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfiles: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '111111111111': {
              accountId: '111111111111',
              roleName: 'AccountOneRole',
            },
            '222222222222': {
              accountId: '222222222222',
              roleName: 'AccountTwoRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['111111111111', '222222222222'],
        service: 'lambda',
        operation: 'ListFunctions',
        regions: ['us-east-1'],
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          integrationWithProfiles,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow(
        'All AWS Service API account requests failed (2 total). First error: AWS request failed: 403 Forbidden - AccessDenied: Denied for account one',
      );

      fetchSpy.mockRestore();
    });

    it('fans out AWS service API requests across multiple regions', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          mockJsonResponse({
            Functions: [
              {
                FunctionArn:
                  'arn:aws:lambda:us-east-1:123456789012:function:east',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            Functions: [
              {
                FunctionArn:
                  'arn:aws:lambda:us-west-2:123456789012:function:west',
              },
            ],
          }),
        );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfile: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['123456789012'],
        service: 'lambda',
        operation: 'ListFunctions',
        regions: ['us-east-1', 'us-west-2'],
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfile,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items).toEqual([
        {
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:east',
          _aws: { accountId: '123456789012', region: 'us-east-1' },
        },
      ]);
      expect(pages[1].items).toEqual([
        {
          FunctionArn: 'arn:aws:lambda:us-west-2:123456789012:function:west',
          _aws: { accountId: '123456789012', region: 'us-west-2' },
        },
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/',
      );
      expect(fetchSpy.mock.calls[1][0]).toBe(
        'https://lambda.us-west-2.amazonaws.com/2015-03-31/functions/',
      );

      fetchSpy.mockRestore();
    });

    it('uses the profile region for AWS service API requests when source regions are not specified', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({
          Functions: [
            {
              FunctionArn:
                'arn:aws:lambda:eu-west-1:123456789012:function:dublin',
            },
          ],
        }),
      );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfileRegion: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
              region: 'eu-west-1',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['123456789012'],
        service: 'lambda',
        operation: 'ListFunctions',
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfileRegion,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://lambda.eu-west-1.amazonaws.com/2015-03-31/functions/',
      );

      fetchSpy.mockRestore();
    });

    it('paginates AWS query service API requests with cursor pagination', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockRejectedValue(
          new Error('fetch should not be used for query protocols'),
        );
      queueHttpsTextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<DescribeInstancesResponse>
  <reservationSet>
    <item>
      <instancesSet>
        <item>
          <instanceId>i-first</instanceId>
        </item>
      </instancesSet>
    </item>
  </reservationSet>
  <nextToken>token-2</nextToken>
</DescribeInstancesResponse>`,
        { headers: { 'content-type': 'text/xml' } },
      );
      queueHttpsTextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<DescribeInstancesResponse>
  <reservationSet>
    <item>
      <instancesSet>
        <item>
          <instanceId>i-second</instanceId>
        </item>
      </instancesSet>
    </item>
  </reservationSet>
</DescribeInstancesResponse>`,
        { headers: { 'content-type': 'text/xml' } },
      );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfile: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['123456789012'],
        service: 'ec2',
        operation: 'DescribeInstances',
        regions: ['us-east-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfile,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items).toEqual([
        {
          instanceId: 'i-first',
          _aws: { accountId: '123456789012', region: 'us-east-1' },
        },
      ]);
      expect(pages[1].items).toEqual([
        {
          instanceId: 'i-second',
          _aws: { accountId: '123456789012', region: 'us-east-1' },
        },
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockHttpsRequest).toHaveBeenCalledTimes(2);
      const firstRequest = mockHttpsRequest.mock.calls[0]?.[0] as {
        hostname: string;
        method: string;
        path: string;
        headers: Record<string, string>;
      };
      const secondRequest = mockHttpsRequest.mock.calls[1]?.[0] as {
        hostname: string;
        method: string;
        path: string;
        headers: Record<string, string>;
      };
      expect(firstRequest.hostname).toBe('ec2.us-east-1.amazonaws.com');
      expect(firstRequest.method).toBe('POST');
      expect(firstRequest.path).toBe('/');
      expect(firstRequest.headers['content-type']).toBe(
        'application/x-www-form-urlencoded; charset=utf-8',
      );
      const firstWrittenBody = (
        mockHttpsRequest.mock.results[0]?.value as { writtenBody: string }
      ).writtenBody;
      expect(firstRequest.headers['content-length']).toBe(
        String(Buffer.byteLength(firstWrittenBody)),
      );
      expect(firstWrittenBody).toBe(
        'Action=DescribeInstances&Version=2016-11-15',
      );
      expect(secondRequest.hostname).toBe('ec2.us-east-1.amazonaws.com');
      expect(secondRequest.method).toBe('POST');
      expect(secondRequest.path).toBe('/');
      const secondWrittenBody = (
        mockHttpsRequest.mock.results[1]?.value as { writtenBody: string }
      ).writtenBody;
      expect(secondRequest.headers['content-length']).toBe(
        String(Buffer.byteLength(secondWrittenBody)),
      );
      expect(secondWrittenBody).toBe(
        'Action=DescribeInstances&Version=2016-11-15&NextToken=token-2',
      );

      fetchSpy.mockRestore();
    });

    it('parses rest-xml responses and uses the S3 endpoint override', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        mockTextResponse(
          `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Buckets>
    <Bucket>
      <Name>bucket-a</Name>
    </Bucket>
    <Bucket>
      <Name>bucket-b</Name>
    </Bucket>
  </Buckets>
</ListAllMyBucketsResult>`,
          { headers: { 'content-type': 'application/xml' } },
        ),
      );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfile: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['123456789012'],
        service: 's3',
        operation: 'ListBuckets',
        regions: ['eu-west-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfile,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toEqual([
        {
          Name: 'bucket-a',
          _aws: { accountId: '123456789012', region: 'eu-west-1' },
        },
        {
          Name: 'bucket-b',
          _aws: { accountId: '123456789012', region: 'eu-west-1' },
        },
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe('https://s3.amazonaws.com/');
      expect(
        (fetchSpy.mock.calls[0][1] as RequestInit | undefined)?.method,
      ).toBe('GET');

      fetchSpy.mockRestore();
    });

    it('uses the IAM global endpoint defaults', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(
          new Error('fetch should not be used for query protocols'),
        );
      queueHttpsTextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<ListRolesResponse>
  <ListRolesResult>
    <Roles>
      <member>
        <Arn>arn:aws:iam::123456789012:role/Admin</Arn>
      </member>
    </Roles>
  </ListRolesResult>
</ListRolesResponse>`,
        { headers: { 'content-type': 'application/xml' } },
      );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfile: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: ['123456789012'],
        service: 'iam',
        operation: 'ListRoles',
        regions: ['eu-west-1'],
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfile,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toEqual([
        {
          Arn: 'arn:aws:iam::123456789012:role/Admin',
          _aws: { accountId: '123456789012', region: 'eu-west-1' },
        },
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
      const request = mockHttpsRequest.mock.calls[0]?.[0] as {
        hostname: string;
        method: string;
        path: string;
        headers: Record<string, string>;
      };
      expect(request.hostname).toBe('iam.amazonaws.com');
      expect(request.method).toBe('POST');
      expect(request.path).toBe('/');
      expect(request.headers['content-type']).toBe(
        'application/x-www-form-urlencoded; charset=utf-8',
      );
      const writtenBody = (
        mockHttpsRequest.mock.results[0]?.value as { writtenBody: string }
      ).writtenBody;
      expect(request.headers['content-length']).toBe(
        String(Buffer.byteLength(writtenBody)),
      );
      const headers = request.headers;
      expect(headers?.authorization).toContain('/us-east-1/iam/aws4_request');
      expect(writtenBody).toBe('Action=ListRoles&Version=2010-05-08');

      fetchSpy.mockRestore();
    });

    it('uses the Organizations global endpoint defaults for account previews', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({
          Accounts: [
            {
              Id: '999999999999',
              Name: 'Management',
              Status: 'ACTIVE',
            },
            {
              Id: '111111111111',
              Name: 'Production',
              Status: 'ACTIVE',
            },
          ],
        }),
      );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithOrganizations: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '333333333333': {
              accountId: '333333333333',
              name: 'Manual only',
              roleName: 'ManualRole',
            },
          },
          organizations: {
            enabled: true,
            managementAccount: {
              accountId: '999999999999',
              roleName: 'ManagementRole',
              region: 'eu-west-1',
            },
            defaults: {
              roleName: 'OrganizationRole',
              region: 'us-east-1',
            },
            excludeManagementAccount: true,
          },
        },
      };

      const result = (await backend.request(integrationWithOrganizations, {
        backendType: 'aws',
        requestKind: 'organizations-account-preview',
      } as AwsOrganizationsAccountPreviewOptions)) as Array<{
        accountId: string;
        roleName?: string;
        region?: string;
        source: string;
      }>;

      expect(result).toEqual([
        expect.objectContaining({
          accountId: '111111111111',
          isManagementAccount: false,
          name: 'Production',
          region: 'us-east-1',
          roleName: 'OrganizationRole',
          source: 'organizations',
        }),
        expect.objectContaining({
          accountId: '333333333333',
          externalId: undefined,
          isManagementAccount: false,
          name: 'Manual only',
          region: undefined,
          roleName: 'ManualRole',
          source: 'manual',
        }),
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://organizations.us-east-1.amazonaws.com/',
      );
      const headers = (fetchSpy.mock.calls[0][1] as RequestInit | undefined)
        ?.headers as Record<string, string> | undefined;
      expect(headers?.authorization).toContain(
        '/us-east-1/organizations/aws4_request',
      );

      fetchSpy.mockRestore();
    });

    it('resolves select-all organization accounts at runtime for service-api sources', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          mockJsonResponse({
            Accounts: [
              {
                Id: '999999999999',
                Name: 'Management',
                Status: 'ACTIVE',
              },
              {
                Id: '111111111111',
                Name: 'Production',
                Status: 'ACTIVE',
              },
              {
                Id: '222222222222',
                Name: 'Shared',
                Status: 'ACTIVE',
              },
            ],
          }),
        )
        .mockResolvedValue(
          mockTextResponse(
            `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Buckets>
    <Bucket>
      <Name>bucket-a</Name>
    </Bucket>
  </Buckets>
</ListAllMyBucketsResult>`,
            { headers: { 'content-type': 'application/xml' } },
          ),
        );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithOrganizations: Integration = {
        ...mockIntegration,
        config: {
          organizations: {
            enabled: true,
            managementAccount: {
              accountId: '999999999999',
              roleName: 'ManagementRole',
              region: 'eu-west-1',
            },
            defaults: {
              roleName: 'OrganizationRole',
              region: 'us-east-1',
            },
            excludeManagementAccount: true,
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountSelection: {
          mode: 'all',
        },
        service: 's3',
        operation: 'ListBuckets',
      };

      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithOrganizations,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://organizations.us-east-1.amazonaws.com/',
      );
      expect(fetchSpy.mock.calls[1][0]).toBe('https://s3.amazonaws.com/');
      expect(fetchSpy.mock.calls[2][0]).toBe('https://s3.amazonaws.com/');
      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: 'arn:aws:iam::999999999999:role/ManagementRole',
          }),
        }),
      );
      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: 'arn:aws:iam::111111111111:role/OrganizationRole',
          }),
        }),
      );
      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: 'arn:aws:iam::222222222222:role/OrganizationRole',
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('emits configured accounts as catalog items without calling AWS APIs', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('fetch should not be used'));
      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfiles: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '333333333333': {
              accountId: '333333333333',
              name: 'Manual',
              roleName: 'ManualRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'configured-accounts',
        requestKind: 'configured-accounts',
      };
      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfiles,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([
        {
          pageIndex: 0,
          items: [
            expect.objectContaining({
              Id: '333333333333',
              Name: 'Manual',
              source: 'manual',
              isManagementAccount: false,
              _aws: { accountId: '333333333333', region: 'us-east-1' },
            }),
          ],
        },
      ]);
      expect(pages[0]?.items[0]).not.toHaveProperty('roleName');
      expect(pages[0]?.items[0]).not.toHaveProperty('externalId');
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('emits organization accounts plus extra manual profiles as catalog items', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({
          Accounts: [
            {
              Id: '111111111111',
              Name: 'Production',
              Email: 'prod@example.com',
              Status: 'ACTIVE',
            },
          ],
        }),
      );
      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithBoth: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '333333333333': {
              accountId: '333333333333',
              name: 'Manual only',
              roleName: 'ManualRole',
            },
          },
          organizations: {
            enabled: true,
            managementAccount: {
              accountId: '999999999999',
              roleName: 'ManagementRole',
              region: 'us-east-1',
            },
            defaults: {
              roleName: 'OrganizationRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'configured-accounts',
        requestKind: 'configured-accounts',
      };
      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithBoth,
        options,
      )) {
        pages.push(page);
      }

      expect(pages[0]?.items).toEqual([
        expect.objectContaining({
          Id: '111111111111',
          Name: 'Production',
          Email: 'prod@example.com',
          Status: 'ACTIVE',
          source: 'organizations',
        }),
        expect.objectContaining({
          Id: '333333333333',
          Name: 'Manual only',
          source: 'manual',
        }),
      ]);
      fetchSpy.mockRestore();
    });

    it('resolves select-all from manual profiles when Organizations is not configured', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        mockTextResponse(
          `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Buckets>
    <Bucket>
      <Name>bucket-a</Name>
    </Bucket>
  </Buckets>
</ListAllMyBucketsResult>`,
          { headers: { 'content-type': 'application/xml' } },
        ),
      );
      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfiles: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '333333333333': {
              accountId: '333333333333',
              roleName: 'ManualRole',
            },
          },
        },
      };

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountSelection: { mode: 'all' },
        service: 's3',
        operation: 'ListBuckets',
      };
      const pages = [];
      for await (const page of backend.requestPages(
        integrationWithProfiles,
        options,
      )) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0]?.items).toEqual([
        expect.objectContaining({
          Name: 'bucket-a',
          _aws: { accountId: '333333333333', region: 'us-east-1' },
        }),
      ]);
      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            RoleArn: 'arn:aws:iam::333333333333:role/ManualRole',
          }),
        }),
      );
      fetchSpy.mockRestore();
    });

    it('returns no pages for select-all when neither Organizations nor profiles are configured', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('fetch should not be used'));
      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestPagesOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountSelection: { mode: 'all' },
        service: 's3',
        operation: 'ListBuckets',
      };
      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('surfaces XML error details for service API requests', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(
          new Error('fetch should not be used for query protocols'),
        );
      queueHttpsTextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse>
  <Error>
    <Code>AccessDenied</Code>
    <Message>Denied for testing</Message>
  </Error>
</ErrorResponse>`,
        {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'content-type': 'application/xml' },
        },
      );

      const backend = new AwsBackend({ logger: voidLogger });
      const integrationWithProfile: Integration = {
        ...mockIntegration,
        config: {
          profiles: {
            '123456789012': {
              accountId: '123456789012',
              roleName: 'TestRole',
            },
          },
        },
      };

      const options: AwsRequestApiOptions = {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-request',
        profile: '123456789012',
        service: 'sns',
        operation: 'ListTopics',
        region: 'us-east-1',
      };

      await expect(
        backend.request(integrationWithProfile, options),
      ).rejects.toThrow(
        'AWS request failed: 403 Forbidden - AccessDenied: Denied for testing',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
      const request = mockHttpsRequest.mock.calls[0]?.[0] as {
        headers: Record<string, string>;
      };
      expect(request.headers.authorization).toContain(
        '/us-east-1/sns/aws4_request',
      );
      expect(
        (mockHttpsRequest.mock.results[0]?.value as { writtenBody: string })
          .writtenBody,
      ).toBe('Action=ListTopics&Version=2010-03-31');

      fetchSpy.mockRestore();
    });
  });

  describe('request CRUD operations', () => {
    it('get operation fetches a single resource', async () => {
      const onRequestLog = vi.fn();
      mockSend.mockResolvedValueOnce({
        ResourceDescription: {
          Properties: JSON.stringify({ BucketName: 'my-bucket' }),
        },
      });

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestResourceOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-resource',
        resourceType: 'AWS::S3::Bucket',
        accountId: '123456789012',
        accountConfig: { accountId: '123456789012' },
        region: 'us-east-1',
        operation: 'get',
        identifier: 'my-bucket',
        onRequestLog,
      };
      const result = await backend.request(mockIntegration, options);

      expect(result).toEqual({ BucketName: 'my-bucket' });
      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'GetResource',
          target: 'AWS::S3::Bucket/my-bucket',
        }),
      );
    });

    it('get operation throws without identifier', async () => {
      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestResourceOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-resource',
        resourceType: 'AWS::S3::Bucket',
        accountId: '123456789012',
        accountConfig: { accountId: '123456789012' },
        region: 'us-east-1',
        operation: 'get',
      };
      await expect(backend.request(mockIntegration, options)).rejects.toThrow(
        'identifier is required for get operation',
      );
    });

    it('non-get operations throw error', async () => {
      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestResourceOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-resource',
        resourceType: 'AWS::S3::Bucket',
        accountId: '123456789012',
        accountConfig: { accountId: '123456789012' },
        region: 'us-east-1',
        operation: 'delete',
        identifier: 'my-bucket',
      };
      await expect(backend.request(mockIntegration, options)).rejects.toThrow(
        'only get operation is supported',
      );
    });

    it('throws descriptive error when accountConfig is missing', async () => {
      const backend = new AwsBackend({ logger: voidLogger });

      const options = {
        backendType: 'aws' as const,
        resourceType: 'AWS::RDS::DBInstance',
        accountId: '123456789012',
        region: 'eu-west-1',
        operation: 'get' as const,
        identifier: 'my-db-instance',
      };
      await expect(backend.request(mockIntegration, options)).rejects.toThrow(
        'Invalid AWS request options',
      );
    });

    it('throws descriptive error when region is missing', async () => {
      const backend = new AwsBackend({ logger: voidLogger });

      const options = {
        backendType: 'aws' as const,
        resourceType: 'AWS::S3::Bucket',
        accountId: '123456789012',
        accountConfig: { accountId: '123456789012' },
      };
      await expect(backend.request(mockIntegration, options)).rejects.toThrow(
        'Invalid AWS request options',
      );
    });

    it('emits request log with error and optional status on request failure', async () => {
      const onRequestLog = vi.fn();
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      const backend = new AwsBackend({ logger: voidLogger });

      const options: AwsRequestResourceOptions = {
        backendType: 'aws',
        mode: 'cloud-control',
        requestKind: 'cloud-control-resource',
        resourceType: 'AWS::S3::Bucket',
        accountId: '123456789012',
        accountConfig: { accountId: '123456789012' },
        region: 'us-east-1',
        operation: 'get',
        identifier: 'my-bucket',
        onRequestLog,
      };
      await expect(backend.request(mockIntegration, options)).rejects.toThrow(
        'Access Denied',
      );

      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'GetResource',
          error: 'Access Denied',
        }),
      );
      expect(onRequestLog.mock.calls[0][0].status).toBeUndefined();
    });
  });

  describe('assume-role policy', () => {
    const integrationWithRole: Integration = {
      ...mockIntegration,
      config: {
        profiles: {
          '123456789012': {
            accountId: '123456789012',
            roleName: 'acme-roadie-read-only',
            externalId: 'tenant-typed',
          },
        },
      },
    };

    const integrationWithoutRole: Integration = {
      ...mockIntegration,
      config: {
        profiles: {
          '123456789012': { accountId: '123456789012' },
        },
      },
    };

    const pageOptions = (scopeId?: string): AwsRequestPagesOptions => ({
      backendType: 'aws',
      mode: 'cloud-control',
      requestKind: 'cloud-control-pages',
      resourceType: 'AWS::S3::Bucket',
      accountIds: ['123456789012'],
      regions: ['us-east-1'],
      ...(scopeId && { scopeId }),
    });

    const strictBackend = () =>
      new AwsBackend({
        logger: voidLogger,
        assumeRolePolicy: createStrictAwsAssumeRolePolicy({
          externalIdSecret: 'test-secret',
        }),
      });

    async function drain(
      backend: AwsBackend,
      integration: Integration,
      options: AwsRequestPagesOptions,
    ) {
      for await (const page of backend.requestPages(integration, options)) {
        void page;
      }
    }

    beforeEach(() => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [],
        NextToken: undefined,
      });
    });

    it('sends the derived external id, source identity and session policy', async () => {
      await drain(strictBackend(), integrationWithRole, pageOptions('acme'));

      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith({
        params: {
          RoleArn: 'arn:aws:iam::123456789012:role/acme-roadie-read-only',
          ExternalId: deriveExternalId('test-secret', 'acme'),
          RoleSessionName: 'integration-aws-test-acme',
          SourceIdentity: 'acme',
          PolicyArns: [{ arn: AWS_READ_ONLY_SESSION_POLICY_ARN }],
        },
        clientConfig: { region: 'us-east-1' },
      });
    });

    it('ignores the tenant-supplied external id', async () => {
      await drain(strictBackend(), integrationWithRole, pageOptions('acme'));

      const { params } = mockFromTemporaryCredentials.mock.calls[0][0];
      expect(params.ExternalId).not.toBe('tenant-typed');
    });

    it('refuses to fall back to ambient credentials', async () => {
      await expect(
        drain(strictBackend(), integrationWithoutRole, pageOptions('acme')),
      ).rejects.toThrow(/does not permit falling back to ambient credentials/);
      expect(mockFromNodeProviderChain).not.toHaveBeenCalled();
    });

    it('fails closed when the request carries no scope', async () => {
      await expect(
        drain(strictBackend(), integrationWithRole, pageOptions()),
      ).rejects.toThrow(/has no scope/);
      expect(mockFromTemporaryCredentials).not.toHaveBeenCalled();
    });

    it('leaves the default (legacy) policy behaviour untouched', async () => {
      // Guards the OSS/self-hosted path: no policy injected means today's
      // pass-through external id, no source identity, no session policy.
      await drain(
        new AwsBackend({ logger: voidLogger }),
        integrationWithRole,
        pageOptions('acme'),
      );

      expect(mockFromTemporaryCredentials).toHaveBeenCalledWith({
        params: {
          RoleArn: 'arn:aws:iam::123456789012:role/acme-roadie-read-only',
          ExternalId: 'tenant-typed',
          RoleSessionName: 'integration-aws-test-acme',
        },
        clientConfig: { region: 'us-east-1' },
      });
    });

    it('still allows ambient credentials under the default policy', async () => {
      await drain(
        new AwsBackend({ logger: voidLogger }),
        integrationWithoutRole,
        pageOptions('acme'),
      );

      expect(mockFromNodeProviderChain).toHaveBeenCalled();
    });
  });
});
