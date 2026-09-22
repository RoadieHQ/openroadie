import React, { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import {
  ApiContext,
  DEFAULT_WORKSPACE_ID,
  type ApiClients,
} from '../../../api';
import type { Workspace } from '../../../api';
import { WorkspaceProvider } from '../workspace-context';
import { WorkspacesPage } from './workspaces-page';

vi.mock('../../../api/feature-flags/use-feature-flag', () => ({
  useFeatureFlag: () => ({ value: false, loading: false }),
}));

const organizationWorkspace: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  slug: 'default',
  type: 'organization',
  svg: null,
  ownerUserId: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const personalWorkspace: Workspace = {
  id: 'f5d0062c-c297-4ed3-b6f5-e00a610c79b6',
  name: "Alice's space",
  slug: 'alice-space',
  type: 'personal',
  svg: null,
  ownerUserId: 'auth0|alice',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

function renderPage(workspaces: Workspace[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const apis = {
    workspaces: { list: vi.fn().mockResolvedValue(workspaces) },
  } as unknown as ApiClients;
  const navigation = { navigate: vi.fn().mockResolvedValue(undefined) };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={apis}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkspaceProvider navigation={navigation}>
            {children}
          </WorkspaceProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ApiContext.Provider>
  );

  return render(<WorkspacesPage />, { wrapper });
}

describe('WorkspacesPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the owner id of a personal workspace', async () => {
    renderPage([organizationWorkspace, personalWorkspace]);

    expect(await screen.findByText('auth0|alice')).toBeInTheDocument();
  });

  // An organization workspace is owned by nobody, and the em dash is what says
  // so — a blank cell reads as data that failed to load.
  it('shows no owner for an organization workspace', async () => {
    renderPage([organizationWorkspace]);

    await screen.findByTestId(`workspace-name-${DEFAULT_WORKSPACE_ID}`);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('does not offer owner actions to a shared member', async () => {
    const user = userEvent.setup();
    renderPage([{ ...personalWorkspace, canManage: false }]);

    const name = await screen.findByTestId(
      `workspace-name-${personalWorkspace.id}`,
    );
    expect(name).not.toHaveAttribute('role', 'button');

    await user.click(
      screen.getByRole('button', {
        name: `Actions for ${personalWorkspace.name}`,
      }),
    );
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.getByText('Share')).toBeInTheDocument();
  });
});
