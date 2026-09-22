import React from 'react';
import { renderHook } from '@testing-library/react';
import { TestQueryProvider } from '../test-utils';
import { ApiContext } from '../api';
import type { ApiClients } from '../api';
import { useBottomNavItems, useNavItems } from './navigation';

function createApis(options: {
  adminEnabled?: boolean;
  flags?: Record<string, unknown>;
}): ApiClients {
  const flags = options.flags ?? {};
  return {
    config: {
      app: {
        title: 'Catalog Builder',
        baseUrl: 'http://localhost:3333',
      },
      features: {
        admin: options.adminEnabled,
      },
      backend: {
        baseUrl: 'http://localhost:7008',
      },
    },
    featureFlags: {
      hasCachedFlags: true,
      getAllFlags: async () => flags,
      getFlag: async (key: string, defaultValue: unknown) =>
        flags[`${key}`] ?? defaultValue,
      getCachedFlag: (key: string, defaultValue: unknown) =>
        flags[`${key}`] ?? defaultValue,
    },
  } as ApiClients;
}

function createWrapper(options: {
  adminEnabled?: boolean;
  flags?: Record<string, unknown>;
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <TestQueryProvider>
        <ApiContext.Provider value={createApis(options)}>
          {children}
        </ApiContext.Provider>
      </TestQueryProvider>
    );
  };
}

describe('useBottomNavItems', () => {
  it('includes all admin sections when flags are enabled', () => {
    const { result } = renderHook(() => useBottomNavItems(), {
      wrapper: createWrapper({
        adminEnabled: true,
        flags: { webhooks: true, 'ai-providers': true },
      }),
    });

    const admin = result.current.find(item => item.text === 'Administration');
    expect(admin).toBeDefined();
    expect(admin?.submenu?.map(s => s.label)).toEqual([
      'Workspaces',
      'Teams',
      'Secrets',
      'AI Providers',
      'Webhooks',
      'MCP Servers',
    ]);
  });

  it('hides webhooks and ai-providers sections when flags are disabled', () => {
    const { result } = renderHook(() => useBottomNavItems(), {
      wrapper: createWrapper({ adminEnabled: true }),
    });

    const admin = result.current.find(item => item.text === 'Administration');
    expect(admin).toBeDefined();
    expect(admin?.submenu?.map(s => s.label)).toEqual([
      'Workspaces',
      'Teams',
      'Secrets',
      'MCP Servers',
    ]);
  });

  it('hides the admin nav item when admin is disabled', () => {
    const { result } = renderHook(() => useBottomNavItems(), {
      wrapper: createWrapper({ adminEnabled: false }),
    });

    expect(result.current.map(item => item.text)).not.toContain(
      'Administration',
    );
  });
});

describe('useNavItems', () => {
  it('includes Relationships and Context Groups when relationships is enabled', () => {
    const { result } = renderHook(() => useNavItems(), {
      wrapper: createWrapper({ flags: { relationships: true } }),
    });

    const labels = result.current.map(item => item.text);
    expect(labels).toContain('Relationships');
    expect(labels).toContain('Context Groups');
  });

  it('hides Relationships and Context Groups when relationships is disabled', () => {
    const { result } = renderHook(() => useNavItems(), {
      wrapper: createWrapper({ flags: { relationships: false } }),
    });

    const labels = result.current.map(item => item.text);
    expect(labels).not.toContain('Relationships');
    expect(labels).not.toContain('Context Groups');
  });
});
