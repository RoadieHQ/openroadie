import { vi, describe, it, expect, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Action, AwsServiceActionRequest } from '@roadiehq/actions-common';
import {
  createInternalFetch,
  internalRequestContextMiddleware,
} from '@roadiehq/extensions-api';
import { ActionsController } from './ActionsController';
import { ActionDao } from '../database';
import { allowAllScopeService, createScopeService } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';

const scopeService = allowAllScopeService;
const defaultWorkspaceId = '00000000-0000-4000-8000-000000000001';

const sampleAction: Action = {
  id: 'a1',
  name: 'Create repo',
  slug: 'create-repo',
  description: '',
  parameters: [
    { name: 'org', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
  ],
  steps: [
    {
      id: 'createRepo',
      integrationId: 'int-123',
      request: {
        method: 'POST',
        path: '/orgs/{{org}}/repos',
        headers: [{ key: 'Accept', value: 'application/json' }],
        body: '{"name":{{name}}}',
      },
    },
  ],
  enabled: true,
  currentVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeAwsRequest(
  overrides: Partial<AwsServiceActionRequest> = {},
): AwsServiceActionRequest {
  return {
    backendType: 'aws',
    mode: 'service-api',
    service: 'lambda',
    operation: 'GetFunction',
    profile: '123456789012',
    region: 'eu-west-1',
    method: 'POST',
    path: '/',
    headers: [{ key: 'x-amz-target', value: 'Lambda.GetFunction' }],
    body: '{}',
    ...overrides,
  };
}

function mockRes() {
  const res: Partial<Response> & { body?: unknown; statusCode: number } = {
    statusCode: 200,
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response['status'];
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res as Response;
  }) as unknown as Response['json'];
  res.send = vi.fn((payload: unknown) => {
    res.body = payload;
    return res as Response;
  }) as unknown as Response['send'];
  return res as Response & { body?: unknown; statusCode: number };
}

function makeAuth() {
  return {
    getOwnServiceCredentials: vi.fn().mockResolvedValue({}),
    getPluginRequestToken: vi.fn().mockResolvedValue({ token: 'tok' }),
  };
}

function makeController(
  action: Action | undefined,
  auth = makeAuth(),
): ActionsController {
  const dao = {
    getByIdOrSlug: vi.fn().mockResolvedValue(action),
  } as unknown as ActionDao;
  const discovery = {
    getBaseUrl: vi.fn().mockResolvedValue('http://backend/api/integrations'),
  };
  return withDefaultWorkspace(
    new ActionsController({
      actionDao: dao,
      // The real credential-resolving fetch over a mocked AuthService, so these
      // tests cover the controller + internalFetch integration end to end.
      internalFetch: createInternalFetch({ auth: auth as any }),
      discovery,
      scopeService,
    } as any),
  );
}

function withDefaultWorkspace(controller: ActionsController) {
  const workspaceIds = Reflect.get(controller, 'workspaceIds') as WeakMap<
    object,
    string
  >;
  vi.spyOn(workspaceIds, 'get').mockReturnValue(defaultWorkspaceId);
  return controller;
}

/**
 * Invoke a controller handler inside the ambient-request context the backend's
 * `internalRequestContextMiddleware` would provide, so internalFetch can see
 * the caller's headers. The fake request needs express's `header()` accessor.
 */
async function executeThroughRequestContext(
  controller: ActionsController,
  req: Record<string, unknown> & { headers?: Record<string, string> },
) {
  const headers = req.headers ?? {};
  const reqWithHeader = {
    ...req,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  await new Promise<void>((resolve, reject) => {
    internalRequestContextMiddleware()(reqWithHeader, {} as Response, () => {
      // RequestHandler is typed void, but execute is async — wrap to await it.
      Promise.resolve(
        controller.execute(reqWithHeader, mockRes(), vi.fn()),
      ).then(() => resolve(), reject);
    });
  });
}

describe('ActionsController.execute', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders templates and proxies to integrations, returning an ok envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: { id: 99 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = makeController(sampleAction);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://backend/api/integrations/int-123/request');
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody).toMatchObject({
      backendType: 'http',
      method: 'POST',
      path: '/orgs/acme/repos',
      headers: { Accept: 'application/json' },
      body: { name: 'widgets' },
    });
    expect(res.body).toEqual({
      ok: true,
      status: 201,
      data: { id: 99 },
      steps: [{ id: 'createRepo', ok: true, status: 201, data: { id: 99 } }],
    });
  });

  it('renders and proxies an AWS service API step', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { FunctionName: 'worker' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const action: Action = {
      ...sampleAction,
      parameters: [{ name: 'functionName', type: 'string', required: true }],
      steps: [
        {
          id: 'getFunction',
          integrationId: 'aws-1',
          request: {
            backendType: 'aws',
            mode: 'service-api',
            service: 'lambda',
            operation: 'GetFunction',
            profile: '123456789012',
            region: 'eu-west-1',
            method: 'POST',
            path: '/',
            headers: [
              {
                key: 'x-amz-target',
                value: 'Lambda.GetFunction',
              },
            ],
            body: '{"FunctionName":{{functionName}}}',
          },
        },
      ],
    };
    const controller = makeController(action);
    const res = mockRes();

    await controller.draftExecute(
      {
        body: {
          parameters: action.parameters,
          steps: action.steps,
          inputs: { functionName: 'worker' },
        },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      backendType: 'aws',
      mode: 'service-api',
      service: 'lambda',
      operation: 'GetFunction',
      profile: '123456789012',
      region: 'eu-west-1',
      method: 'POST',
      path: '/',
      headers: { 'x-amz-target': 'Lambda.GetFunction' },
      body: '{"FunctionName":"worker"}',
    });
    expect(res.body).toEqual({
      ok: true,
      status: 200,
      data: { FunctionName: 'worker' },
      steps: [
        {
          id: 'getFunction',
          ok: true,
          status: 200,
          data: { FunctionName: 'worker' },
        },
      ],
    });
  });

  it.each([
    [
      makeAwsRequest({ body: '{"FunctionName":}' }),
      'Rendered request body is not valid JSON',
    ],
    [
      makeAwsRequest({ service: '{{bogus()}}' }),
      'Unknown template function: bogus() (available: uuidv4())',
    ],
  ])('rejects invalid AWS request templates', async (request, message) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const action: Action = {
      ...sampleAction,
      parameters: [],
      steps: [{ id: 'getFunction', integrationId: 'aws-1', request }],
    };
    const controller = makeController(action);
    const res = mockRes();

    await controller.draftExecute(
      {
        body: { parameters: [], steps: action.steps, inputs: {} },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      ok: false,
      status: 400,
      error: { message },
    });
  });

  it('resolves earlier step outputs in AWS routing fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            service: 'lambda',
            operation: 'GetFunction',
            account: '123456789012',
            region: 'eu-west-1',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { FunctionName: 'worker' } }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const action: Action = {
      ...sampleAction,
      steps: [
        {
          id: 'lookup',
          integrationId: 'http-1',
          request: { method: 'GET', path: '/context', headers: [], body: '' },
        },
        {
          id: 'getFunction',
          integrationId: 'aws-1',
          request: makeAwsRequest({
            service: '{{steps.lookup.data.service}}',
            operation: '{{steps.lookup.data.operation}}',
            profile: '{{steps.lookup.data.account}}',
            region: '{{steps.lookup.data.region}}',
          }),
        },
      ],
    };
    const controller = makeController(action);

    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      mockRes(),
      vi.fn(),
    );

    const sentBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(sentBody).toMatchObject({
      backendType: 'aws',
      service: 'lambda',
      operation: 'GetFunction',
      profile: '123456789012',
      region: 'eu-west-1',
    });
  });

  it('runs steps sequentially, feeding earlier outputs into later templates', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { default_branch: 'main' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { protected: true } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const action: Action = {
      ...sampleAction,
      steps: [
        {
          id: 'findRepo',
          integrationId: 'int-github',
          request: {
            method: 'GET',
            path: '/repos/{{org}}/{{name}}',
            headers: [],
            body: '',
          },
        },
        {
          id: 'protect',
          integrationId: 'int-other',
          request: {
            method: 'PUT',
            path: '/repos/{{org}}/{{name}}/branches/{{steps.findRepo.data.default_branch}}/protection',
            headers: [],
            body: '{"branch":{{steps.findRepo.data.default_branch}}}',
          },
        },
      ],
    };
    const controller = makeController(action);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Each step goes to its own integration.
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://backend/api/integrations/int-github/request',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://backend/api/integrations/int-other/request',
    );
    const second = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(second.path).toBe('/repos/acme/widgets/branches/main/protection');
    expect(second.body).toEqual({ branch: 'main' });

    expect(res.body).toEqual({
      ok: true,
      status: 200,
      data: { protected: true },
      steps: [
        {
          id: 'findRepo',
          ok: true,
          status: 200,
          data: { default_branch: 'main' },
        },
        { id: 'protect', ok: true, status: 200, data: { protected: true } },
      ],
    });
  });

  it('halts on the first failed step and reports executed step results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'Not found' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const action: Action = {
      ...sampleAction,
      steps: [
        {
          id: 'first',
          integrationId: 'int-1',
          request: { method: 'GET', path: '/a', headers: [], body: '' },
        },
        {
          id: 'second',
          integrationId: 'int-1',
          request: { method: 'GET', path: '/b', headers: [], body: '' },
        },
      ],
    };
    const controller = makeController(action);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    // Second step never runs.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({
      ok: false,
      status: 404,
      error: { message: 'Not found' },
      steps: [
        {
          id: 'first',
          ok: false,
          status: 404,
          error: { message: 'Not found' },
        },
      ],
    });
  });

  it('fails a step whose step reference cannot be evaluated', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const action: Action = {
      ...sampleAction,
      steps: [
        {
          id: 'first',
          integrationId: 'int-1',
          request: { method: 'GET', path: '/a', headers: [], body: '' },
        },
        {
          id: 'second',
          integrationId: 'int-1',
          // Unparseable jsonata — trailing `[`.
          request: {
            method: 'GET',
            path: '/b/{{steps.first.data.[}}',
            headers: [],
            body: '',
          },
        },
      ],
    };
    const controller = makeController(action);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    // Only the first step reaches the integration.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = res.body as {
      ok: boolean;
      status: number;
      steps: Array<{ id: string; ok: boolean; status: number }>;
    };
    expect(body.ok).toBe(false);
    expect(body.status).toBe(400);
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0]).toMatchObject({ id: 'first', ok: true });
    expect(body.steps[1]).toMatchObject({
      id: 'second',
      ok: false,
      status: 400,
    });
  });

  it('forwards the caller authorization and x-scope-id headers to integrations-backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const auth = makeAuth();
    const controller = makeController(sampleAction, auth);
    await executeThroughRequestContext(controller, {
      params: { idOrSlug: 'create-repo' },
      headers: {
        authorization: 'Bearer caller-token',
        'x-scope-id': 'tenant-42',
      },
      body: { inputs: { org: 'acme', name: 'widgets' } },
    });

    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer caller-token');
    expect(headers.get('x-scope-id')).toBe('tenant-42');
    // The caller's token is forwarded, so no service token is minted.
    expect(auth.getPluginRequestToken).not.toHaveBeenCalled();
  });

  it('falls back to a minted service token outside any request context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = makeController(sampleAction);
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      mockRes(),
      vi.fn(),
    );

    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer tok');
  });

  it('escapes string inputs so they cannot inject into the JSON body or path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = makeController(sampleAction);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: {
          inputs: { org: '../../admin', name: 'x","admin":true' },
        },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    // Path input can't escape its segment; body input stays a single string
    // value (it can't inject sibling JSON keys) once parsed into the object
    // forwarded to integrations-backend.
    expect(sentBody.path).toBe('/orgs/..%2F..%2Fadmin/repos');
    expect(sentBody.body).toEqual({ name: 'x","admin":true' });
  });

  it('rejects a body template that renders to invalid JSON without proxying', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Trailing comma — the rendered body is not valid JSON.
    const action: Action = {
      ...sampleAction,
      steps: [
        {
          ...sampleAction.steps[0],
          request: {
            ...sampleAction.steps[0].request,
            body: '{"name":{{name}},}',
          },
        },
      ],
    };
    const controller = makeController(action);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      ok: false,
      status: 400,
      error: { message: 'Rendered request body is not valid JSON' },
      steps: [
        {
          id: 'createRepo',
          ok: false,
          status: 400,
          error: { message: 'Rendered request body is not valid JSON' },
        },
      ],
    });
  });

  it('rejects a body template calling an unknown function with a 400 envelope', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const action: Action = {
      ...sampleAction,
      steps: [
        {
          ...sampleAction.steps[0],
          request: {
            ...sampleAction.steps[0].request,
            body: '{"name":{{name}},"id":{{bogus()}}}',
          },
        },
      ],
    };
    const controller = makeController(action);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      ok: false,
      status: 400,
      error: {
        message: 'Unknown template function: bogus() (available: uuidv4())',
      },
    });
  });

  it('returns 400 when required inputs are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const controller = makeController(sampleAction);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme' } },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the action does not exist', async () => {
    const controller = makeController(undefined);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'nope' },
        body: { inputs: {} },
      } as unknown as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(404);
  });

  it('surfaces an integration error as an ok:false envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'Integration not found' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = makeController(sampleAction);
    const res = mockRes();
    await controller.execute(
      {
        params: { idOrSlug: 'create-repo' },
        body: { inputs: { org: 'acme', name: 'widgets' } },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      status: 404,
      error: { message: 'Integration not found' },
    });
  });
});

describe('ActionsController.list', () => {
  afterEach(() => vi.restoreAllMocks());

  function makeListController(svc: ScopeService) {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const dao = { list } as unknown as ActionDao;
    const controller = withDefaultWorkspace(
      new ActionsController({
        actionDao: dao,
        auth: {},
        discovery: {},
        scopeService: svc,
      } as any),
    );
    return { controller, list };
  }

  it('passes no identifier restriction under the allow-all resolver', async () => {
    const { controller, list } = makeListController(allowAllScopeService);
    await controller.list(
      { query: {} } as unknown as Request,
      mockRes(),
      vi.fn(),
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ allowedIdentifiers: undefined }),
    );
  });

  it('passes no restriction when the un-narrowed action:query is granted', async () => {
    const { controller, list } = makeListController(
      createScopeService(() => ['action:query']),
    );
    await controller.list(
      { query: {} } as unknown as Request,
      mockRes(),
      vi.fn(),
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ allowedIdentifiers: undefined }),
    );
  });

  it('restricts to the granted targets for a narrowed caller', async () => {
    const { controller, list } = makeListController(
      createScopeService(() => [
        'action:query:create-shortcut-ticket',
        'action:query:create-repo',
      ]),
    );
    await controller.list(
      { query: {} } as unknown as Request,
      mockRes(),
      vi.fn(),
    );
    const { allowedIdentifiers } = list.mock.calls[0][0];
    expect([...allowedIdentifiers].sort()).toEqual([
      'create-repo',
      'create-shortcut-ticket',
    ]);
  });
});

describe('ActionsController.draftExecute', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the body-supplied steps without a DAO lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const dao = { getByIdOrSlug: vi.fn() } as unknown as ActionDao;
    const discovery = {
      getBaseUrl: vi.fn().mockResolvedValue('http://backend/api/integrations'),
    };
    const controller = withDefaultWorkspace(
      new ActionsController({
        actionDao: dao,
        internalFetch: createInternalFetch({ auth: makeAuth() as any }),
        discovery,
        scopeService,
      } as any),
    );

    const res = mockRes();
    await controller.draftExecute(
      {
        body: {
          parameters: [{ name: 'org', type: 'string', required: true }],
          steps: [
            {
              id: 'createRepo',
              integrationId: 'int-123',
              request: {
                method: 'POST',
                path: '/orgs/{{org}}/repos',
                headers: [],
                body: '',
              },
            },
          ],
          inputs: { org: 'acme' },
        },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(dao.getByIdOrSlug).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://backend/api/integrations/int-123/request');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      method: 'POST',
      path: '/orgs/acme/repos',
    });
    expect(res.body).toEqual({
      ok: true,
      status: 200,
      data: { ok: true },
      steps: [{ id: 'createRepo', ok: true, status: 200, data: { ok: true } }],
    });
  });

  it('applies a parameter default when its input is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const dao = { getByIdOrSlug: vi.fn() } as unknown as ActionDao;
    const discovery = {
      getBaseUrl: vi.fn().mockResolvedValue('http://backend/api/integrations'),
    };
    const controller = withDefaultWorkspace(
      new ActionsController({
        actionDao: dao,
        internalFetch: createInternalFetch({ auth: makeAuth() as any }),
        discovery,
        scopeService,
      } as any),
    );

    const res = mockRes();
    await controller.draftExecute(
      {
        body: {
          parameters: [
            { name: 'visibility', type: 'string', default: 'public' },
          ],
          steps: [
            {
              id: 'createRepo',
              integrationId: 'int-1',
              request: {
                method: 'POST',
                path: '/repos',
                headers: [],
                body: '{"visibility":{{visibility}}}',
              },
            },
          ],
          inputs: {},
        },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody.body).toEqual({ visibility: 'public' });
  });

  it('returns 400 when a required draft input is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const controller = makeController(undefined);
    const res = mockRes();
    await controller.draftExecute(
      {
        body: {
          parameters: [{ name: 'org', type: 'string', required: true }],
          steps: [
            {
              id: 'x',
              integrationId: 'int-1',
              request: { method: 'GET', path: '/x', headers: [], body: '' },
            },
          ],
          inputs: {},
        },
      } as unknown as Request,
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a draft with a duplicate step id', async () => {
    const controller = makeController(undefined);
    const res = mockRes();
    const step = {
      id: 'dup',
      integrationId: 'int-1',
      request: { method: 'GET', path: '/x', headers: [], body: '' },
    };
    await controller.draftExecute(
      {
        body: { parameters: [], steps: [step, step], inputs: {} },
      } as unknown as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a draft with a reserved step id', async () => {
    const controller = makeController(undefined);
    const res = mockRes();
    await controller.draftExecute(
      {
        body: {
          parameters: [],
          steps: [
            {
              id: 'true',
              integrationId: 'int-1',
              request: { method: 'GET', path: '/x', headers: [], body: '' },
            },
          ],
          inputs: {},
        },
      } as unknown as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a draft with an invalid step id', async () => {
    const controller = makeController(undefined);
    const res = mockRes();
    await controller.draftExecute(
      {
        body: {
          parameters: [],
          steps: [
            {
              id: 'find-repo',
              integrationId: 'int-1',
              request: { method: 'GET', path: '/x', headers: [], body: '' },
            },
          ],
          inputs: {},
        },
      } as unknown as Request,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
  });
});
