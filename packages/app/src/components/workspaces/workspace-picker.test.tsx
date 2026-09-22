import React, { type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { ApiContext, DEFAULT_WORKSPACE_ID, type ApiClients } from '../../api';
import type { Workspace } from '../../api';
import { WorkspaceProvider } from './workspace-context';
import { WorkspacePicker } from './workspace-picker';

const mockUseFeatureFlag = vi.fn();
vi.mock('../../api/feature-flags/use-feature-flag', () => ({
  useFeatureFlag: (...args: unknown[]) => mockUseFeatureFlag(...args),
}));

const defaultWorkspace: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  slug: 'default',
  type: 'organization',
  svg: null,
  ownerUserId: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

function renderPicker(workspaces: Workspace[] = [defaultWorkspace]) {
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
        <TooltipProvider>
          <WorkspaceProvider navigation={navigation}>
            {children}
          </WorkspaceProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ApiContext.Provider>
  );

  return render(<WorkspacePicker collapsed={false} />, { wrapper });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole('button', {
    name: /Workspace: Default/,
  });
  await user.click(trigger);
}

describe('WorkspacePicker', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUseFeatureFlag.mockReturnValue({ value: false, loading: false });
  });

  it('names the active workspace on the trigger', async () => {
    renderPicker();
    expect(
      await screen.findByRole('button', { name: /Workspace: Default/ }),
    ).toBeInTheDocument();
  });

  it('filters workspaces immediately by name or slug', async () => {
    const user = userEvent.setup();
    renderPicker([
      defaultWorkspace,
      {
        ...defaultWorkspace,
        id: 'platform',
        name: 'Platform Engineering',
        slug: 'platform-team',
      },
      {
        ...defaultWorkspace,
        id: 'payments',
        name: 'Payments',
        slug: 'money-movement',
      },
    ]);
    await openMenu(user);

    const search = screen.getByRole('searchbox', {
      name: 'Search workspaces',
    });
    expect(search).toHaveFocus();

    await user.type(search, 'money');

    expect(screen.getByRole('menuitem', { name: /Payments/ })).toBeVisible();
    expect(
      screen.queryByRole('menuitem', { name: /Platform Engineering/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: /Default/ }),
    ).not.toBeInTheDocument();
  });

  it('groups an available team workspace separately', async () => {
    const user = userEvent.setup();
    renderPicker([
      defaultWorkspace,
      {
        ...defaultWorkspace,
        id: 'platform',
        name: 'Platform',
        slug: 'platform',
        type: 'team',
      },
    ]);
    await openMenu(user);

    expect(screen.getByText('Teams')).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Platform/ })).toBeVisible();
  });

  it('closes on Escape and clears the search', async () => {
    const user = userEvent.setup();
    renderPicker();
    await openMenu(user);

    const search = screen.getByRole('searchbox', {
      name: 'Search workspaces',
    });
    await user.type(search, 'missing');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await openMenu(user);
    expect(
      screen.getByRole('searchbox', { name: 'Search workspaces' }),
    ).toHaveValue('');
  });

  describe('with workspace-creation off', () => {
    it('keeps existing workspaces selectable and disables creation', async () => {
      const user = userEvent.setup();
      renderPicker();
      const trigger = await screen.findByRole('button', {
        name: /Workspace: Default/,
      });

      expect(trigger).toBeEnabled();
      await user.click(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: /New workspace/ }),
      ).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('with workspace-creation on', () => {
    beforeEach(() => {
      mockUseFeatureFlag.mockReturnValue({ value: true, loading: false });
    });

    it('opens the create dialog', async () => {
      const user = userEvent.setup();
      renderPicker();
      await openMenu(user);

      await user.click(screen.getByRole('menuitem', { name: /New workspace/ }));

      await waitFor(() =>
        expect(screen.getByRole('dialog')).toBeInTheDocument(),
      );
      expect(
        screen.getByRole('heading', { name: 'New workspace' }),
      ).toBeInTheDocument();
    });
  });
});
