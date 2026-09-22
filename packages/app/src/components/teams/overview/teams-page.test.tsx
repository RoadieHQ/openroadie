import React, { type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ApiContext, type ApiClients, type Team } from '../../../api';
import { TeamsPage } from './teams-page';

const team: Team = {
  id: '1dc3881e-70fa-41aa-a5cf-b1d888a6d6a7',
  name: 'Platform',
  slug: 'platform',
  memberCount: 1,
  createdAt: '2026-09-04T00:00:00Z',
  updatedAt: '2026-09-04T00:00:00Z',
};

function renderPage(teams: Team[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const workspaces = {
    listTeams: vi.fn().mockResolvedValue(teams),
    createTeam: vi.fn().mockResolvedValue(team),
    updateTeam: vi.fn().mockResolvedValue(team),
    deleteTeam: vi.fn().mockResolvedValue(undefined),
    listTeamMembers: vi.fn().mockResolvedValue([
      {
        userId: 'auth0|alice',
        email: 'alice@example.com',
        createdAt: '2026-09-04T00:00:00Z',
      },
    ]),
    addTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
  };
  const apis = { workspaces } as unknown as ApiClients;
  Object.assign(apis, {
    alert: { post: vi.fn() },
    featureFlags: {
      hasCachedFlags: true,
      getCachedFlag: (_key: string, defaultValue: unknown) =>
        defaultValue === false ? true : defaultValue,
      getFlag: async (_key: string, defaultValue: unknown) =>
        defaultValue === false ? true : defaultValue,
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={apis}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </ApiContext.Provider>
  );

  render(<TeamsPage />, { wrapper });
  return workspaces;
}

describe('TeamsPage', () => {
  it('opens a team and shows its members', async () => {
    const user = userEvent.setup();
    renderPage([team]);

    await user.click(await screen.findByRole('button', { name: 'Platform' }));

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('1 member')).toBeInTheDocument();
  });

  it('creates a team from the empty state', async () => {
    const user = userEvent.setup();
    const workspaces = renderPage([]);

    await user.click(
      await screen.findByRole('button', { name: 'Create team' }),
    );
    await user.type(screen.getByLabelText(/Name/), 'Developer Experience');
    expect(screen.getByLabelText(/Slug/)).toHaveValue('developer-experience');
    await user.clear(screen.getByLabelText(/Slug/));
    await user.type(screen.getByLabelText(/Slug/), 'custom-team');
    await user.type(screen.getByLabelText(/Name/), ' Team');
    expect(screen.getByLabelText(/Slug/)).toHaveValue('custom-team');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() =>
      expect(workspaces.createTeam).toHaveBeenCalledWith({
        name: 'Developer Experience Team',
        slug: 'custom-team',
      }),
    );
  });
});
