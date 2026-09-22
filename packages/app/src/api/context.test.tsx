import React from 'react';
import { renderHook } from '@testing-library/react';
import {
  ApiContext,
  useApis,
  useWorkflows,
  useDatastore,
  useAlert,
  useAppConfig,
  useSecrets,
  useAgent,
} from './context';
import type { ApiClients } from './context';

const mockApis = {
  config: { app: { title: 'Test', baseUrl: '' }, backend: { baseUrl: '' } },
  workflows: { workflows: { list: vi.fn() } },
  datastore: { queryAllObjects: vi.fn() },
  secrets: { getKeys: vi.fn() },
  permissions: {},
  agent: { call: vi.fn() },
  alert: { post: vi.fn(), subscribe: vi.fn() },
} as unknown as ApiClients;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ApiContext.Provider value={mockApis}>{children}</ApiContext.Provider>
);

describe('API context hooks', () => {
  it('each selector hook returns its slice of the provided context', () => {
    const { result } = renderHook(
      () => ({
        apis: useApis(),
        workflows: useWorkflows(),
        datastore: useDatastore(),
        alert: useAlert(),
        config: useAppConfig(),
        secrets: useSecrets(),
        agent: useAgent(),
      }),
      { wrapper },
    );
    expect(result.current.apis).toBe(mockApis);
    expect(result.current.workflows).toBe(mockApis.workflows);
    expect(result.current.datastore).toBe(mockApis.datastore);
    expect(result.current.alert).toBe(mockApis.alert);
    expect(result.current.config).toBe(mockApis.config);
    expect(result.current.secrets).toBe(mockApis.secrets);
    expect(result.current.agent).toBe(mockApis.agent);
  });
});
