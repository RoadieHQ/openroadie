import React, { type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiContext,
  type ApiClients,
  type Workspace,
  type WorkspaceMember,
} from '../../api';
import { WorkspaceShareDialog } from './workspace-share-dialog';

const workspace: Workspace = {
  id: 'f5d0062c-c297-4ed3-b6f5-e00a610c79b6',
  name: 'Platform',
  slug: 'platform',
  type: 'personal',
  svg: null,
  ownerUserId: 'auth0|alice',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function renderDialog() {
  const members: WorkspaceMember[] = [
    {
      userId: 'auth0|alice',
      email: 'alice@example.com',
      role: 'owner' as const,
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ];
  const workspaces = {
    listMembers: vi.fn().mockImplementation(async () => ({
      members: [...members],
      canManage: true,
    })),
    addMember: vi
      .fn()
      .mockImplementation(async (_id: string, email: string) => {
        const member = {
          userId: 'auth0|bob',
          email,
          role: 'member' as const,
          createdAt: '2026-09-03T00:00:00.000Z',
        };
        members.push(member);
        return member;
      }),
    removeMember: vi.fn(),
  };
  const apis = { workspaces } as unknown as ApiClients;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider value={apis}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );

  render(
    <WorkspaceShareDialog workspace={workspace} onOpenChange={vi.fn()} />,
    { wrapper },
  );
  return workspaces;
}

describe('WorkspaceShareDialog', () => {
  it('adds a person by email and shows the updated access list', async () => {
    const user = userEvent.setup();
    const api = renderDialog();

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email address'), 'bob@example.com');
    await user.click(screen.getByRole('button', { name: 'Add person' }));

    await waitFor(() =>
      expect(api.addMember).toHaveBeenCalledWith(
        workspace.id,
        'bob@example.com',
      ),
    );
    expect(await screen.findByText('bob@example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove bob@example.com' }),
    ).toBeInTheDocument();
  });
});
