import React from 'react';
import { render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

// The `~admin-section-extensions` seam is what a deployment overlay replaces to
// register admin sections. Mock it with a fake contribution to prove the host
// wires an extension end-to-end (sidebar list + validTabs + rendered Component).
vi.mock('~admin-section-extensions', () => ({
  adminSectionExtensions: [
    {
      value: 'fake-section',
      label: 'Fake Section',
      path: '/admin/fake-section',
      icon: () => null,
      Component: (props: { backendBaseUrl: string }) => (
        <div data-testid="fake-section">{props.backendBaseUrl}</div>
      ),
    },
  ],
}));

import { TestQueryProvider } from '../../test-utils';
import { ApiContext } from '../../api';
import type { ApiClients } from '../../api';
import { useAdminSections } from '../../config/admin-sections';
import { AdminPage } from './admin-page';

function createApis(): ApiClients {
  return {
    config: {
      app: { title: 'Catalog Builder', baseUrl: 'http://localhost:3333' },
      features: { admin: true },
      backend: { baseUrl: 'http://localhost:7008' },
    },
    fetch: (async () => new Response()) as typeof fetch,
    alert: { post: () => {} },
    featureFlags: {
      hasCachedFlags: true,
      getAllFlags: async () => ({}),
      getFlag: async (_key: string, defaultValue: unknown) => defaultValue,
      getCachedFlag: (_key: string, defaultValue: unknown) => defaultValue,
    },
  } as unknown as ApiClients;
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestQueryProvider>
      <ApiContext.Provider value={createApis()}>{children}</ApiContext.Provider>
    </TestQueryProvider>
  );
}

describe('admin-section extensions seam', () => {
  it('merges registered extensions into the admin sections list', () => {
    const { result } = renderHook(() => useAdminSections(), {
      wrapper: Wrapper,
    });

    const values = result.current.map(s => s.value);
    // Appended after the built-ins.
    expect(values).toContain('fake-section');
    expect(values.indexOf('fake-section')).toBe(values.length - 1);
    expect(values.indexOf('secrets')).toBeLessThan(
      values.indexOf('fake-section'),
    );
  });

  it('accepts the extension tab in validTabs and renders its Component with host services', () => {
    render(
      <Wrapper>
        <MemoryRouter initialEntries={['/admin/fake-section']}>
          <Routes>
            <Route path="/admin/:tab" element={<AdminPage />} />
            <Route
              path="/admin/secrets"
              element={<div>secrets fallback</div>}
            />
          </Routes>
        </MemoryRouter>
      </Wrapper>,
    );

    // Rendered the extension (did not redirect to the secrets fallback)...
    const section = screen.getByTestId('fake-section');
    expect(section).toBeInTheDocument();
    // ...and was handed the injected host services.
    expect(section).toHaveTextContent('http://localhost:7008');
    expect(screen.queryByText('secrets fallback')).not.toBeInTheDocument();
  });
});
