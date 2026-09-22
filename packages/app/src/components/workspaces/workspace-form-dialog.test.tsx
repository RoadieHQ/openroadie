import React, { type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiContext, DEFAULT_WORKSPACE_ID, type ApiClients } from '../../api';
import type { Workspace } from '../../api';
import {
  WorkspaceCreateDialog,
  WorkspaceEditDialog,
} from './workspace-form-dialog';

const workspace: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  slug: 'default',
  type: 'organization',
  svg: null,
  ownerUserId: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

function setup(ui: (api: { create: unknown; update: unknown }) => ReactNode) {
  const create = vi.fn().mockResolvedValue(workspace);
  const update = vi.fn().mockResolvedValue(workspace);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const apis = {
    workspaces: {
      create,
      update,
      list: vi.fn().mockResolvedValue([workspace]),
    },
  } as unknown as ApiClients;

  render(
    <ApiContext.Provider value={apis}>
      <QueryClientProvider client={queryClient}>
        {ui({ create, update })}
      </QueryClientProvider>
    </ApiContext.Provider>,
  );

  return { create, update, queryClient };
}

describe('WorkspaceCreateDialog', () => {
  it('derives the slug from the name until the slug is edited', async () => {
    const user = userEvent.setup();
    setup(() => <WorkspaceCreateDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText(/Name/), 'Acme Corp');
    expect(screen.getByLabelText(/Slug/)).toHaveValue('acme-corp');

    await user.clear(screen.getByLabelText(/Slug/));
    await user.type(screen.getByLabelText(/Slug/), 'acme');
    await user.type(screen.getByLabelText(/Name/), ' Two');

    // The name kept typing, but the slug is the user's now.
    expect(screen.getByLabelText(/Slug/)).toHaveValue('acme');
  });

  it('rejects a slug that is not in the backend grammar', async () => {
    const user = userEvent.setup();
    const { create } = setup(() => (
      <WorkspaceCreateDialog open onOpenChange={vi.fn()} />
    ));

    await user.type(screen.getByLabelText(/Name/), 'Acme');
    await user.clear(screen.getByLabelText(/Slug/));
    await user.type(screen.getByLabelText(/Slug/), 'Acme Corp!');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(
      await screen.findByText(/Lowercase letters, numbers and single hyphens/),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('submits name, slug, type and mark', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    const { create } = setup(() => (
      <WorkspaceCreateDialog
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    ));

    await user.type(screen.getByLabelText(/Name/), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Acme',
        slug: 'acme',
        type: 'personal',
        svg: null,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalledWith(workspace);
  });
});

describe('WorkspaceEditDialog', () => {
  it('renders with the slug shown but not editable', () => {
    setup(() => (
      <WorkspaceEditDialog open onOpenChange={vi.fn()} workspace={workspace} />
    ));

    expect(screen.getByLabelText(/Name/)).toHaveValue('Default');
    const slug = screen.getByLabelText(/Slug/);
    expect(slug).toHaveValue('default');
    expect(slug).toBeDisabled();
  });

  it('saves the name and closes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { update } = setup(() => (
      <WorkspaceEditDialog
        open
        onOpenChange={onOpenChange}
        workspace={workspace}
      />
    ));

    await user.clear(screen.getByLabelText(/Name/));
    await user.type(screen.getByLabelText(/Name/), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(workspace.id, {
        name: 'Acme',
        svg: null,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
