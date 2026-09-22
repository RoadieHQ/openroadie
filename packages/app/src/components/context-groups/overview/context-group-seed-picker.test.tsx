import React, { type ReactElement } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../../../test-utils';

import { ContextGroupSeedPicker } from './context-group-seed-picker';
import type { ContextGroupSeed } from '../../../api/workflow/workflow-client';

const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual =
    await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

const render = (ui: ReactElement) =>
  renderWithQuery(<MemoryRouter>{ui}</MemoryRouter>);

const mockListContextGroupSeeds = vi.fn();
const mockApplyContextGroupSeeds = vi.fn();
const mockAlertPost = vi.fn();

const stableApi = {
  workflows: {
    listContextGroupSeeds: mockListContextGroupSeeds,
    applyContextGroupSeeds: mockApplyContextGroupSeeds,
  },
};
const stableAlert = { post: mockAlertPost };

vi.mock('../../../api', () => ({
  useWorkflows: () => stableApi,
  useAlert: () => stableAlert,
}));

function makeSeed(overrides?: Partial<ContextGroupSeed>): ContextGroupSeed {
  return {
    name: 'Repositories',
    slug: 'repositories',
    description: 'Groups equivalent repository records across providers.',
    created: false,
    dataSources: { total: 8, available: 2, enabled: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContextGroupSeedPicker', () => {
  it('renders seeds with readiness labels', async () => {
    mockListContextGroupSeeds.mockResolvedValue({
      data: [
        makeSeed(),
        makeSeed({
          name: 'Teams',
          slug: 'teams',
          description: 'Teams and groups across systems.',
          dataSources: { total: 4, available: 2, enabled: 0 },
        }),
      ],
    });

    render(
      <ContextGroupSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Repositories')).toBeInTheDocument();
    });
    expect(screen.getByText('Teams')).toBeInTheDocument();
    expect(screen.getByText('1 of 8 sources enabled')).toBeInTheDocument();
    expect(screen.getByText('0 of 4 sources enabled')).toBeInTheDocument();
  });

  it('hides seeds with no available data sources behind a toggle', async () => {
    const user = userEvent.setup();
    mockListContextGroupSeeds.mockResolvedValue({
      data: [
        makeSeed(),
        makeSeed({
          name: 'People',
          slug: 'people',
          dataSources: { total: 18, available: 0, enabled: 0 },
        }),
      ],
    });

    render(
      <ContextGroupSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Repositories')).toBeInTheDocument();
    });
    expect(screen.queryByText('People')).not.toBeInTheDocument();
    expect(screen.getByText('Select all (1)')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: 'Show 1 more with no available data sources',
      }),
    );
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Select all (2)')).toBeInTheDocument();

    // Re-hiding drops any selection that would become invisible.
    await user.click(screen.getByText('People'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Hide templates with no available data sources',
      }),
    );
    expect(screen.queryByText('People')).not.toBeInTheDocument();
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });

  it('always shows a created seed even when its sources are unavailable', async () => {
    mockListContextGroupSeeds.mockResolvedValue({
      data: [
        makeSeed({
          created: true,
          ruleId: 'rule-1',
          dataSources: { total: 8, available: 0, enabled: 0 },
        }),
      ],
    });

    render(
      <ContextGroupSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
    );

    expect(await screen.findByText('Repositories')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /no available data sources/ }),
    ).not.toBeInTheDocument();
  });

  it('shows loading skeletons while fetching seeds', () => {
    mockListContextGroupSeeds.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <ContextGroupSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
    );

    expect(container.querySelector('.motion-skeleton')).toBeInTheDocument();
  });

  it('applies the selected seed slugs and clears the selection', async () => {
    const user = userEvent.setup();
    mockListContextGroupSeeds.mockResolvedValue({
      data: [makeSeed(), makeSeed({ name: 'People', slug: 'people' })],
    });
    mockApplyContextGroupSeeds.mockResolvedValue({
      data: { created: 2, updated: 0, skipped: 0, unresolved: 0 },
    });
    const onComplete = vi.fn();

    render(
      <ContextGroupSeedPicker
        onComplete={onComplete}
        onCreateCustom={vi.fn()}
      />,
    );

    await user.click(await screen.findByText('Repositories'));
    await user.click(screen.getByText('People'));
    await user.click(
      screen.getByRole('button', { name: 'Enable context groups' }),
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(mockApplyContextGroupSeeds).toHaveBeenCalledWith(
      expect.arrayContaining(['repositories', 'people']),
    );
    expect(mockAlertPost).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Created 2 context groups',
        severity: 'success',
      }),
    );
  });

  it('mentions updated groups in the toast when a seed was upgraded', async () => {
    const user = userEvent.setup();
    mockListContextGroupSeeds.mockResolvedValue({
      data: [
        makeSeed({ created: true, ruleId: 'rule-1', updateAvailable: true }),
      ],
    });
    mockApplyContextGroupSeeds.mockResolvedValue({
      data: { created: 0, updated: 1, skipped: 0, unresolved: 0 },
    });

    render(
      <ContextGroupSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
    );

    await user.click(await screen.findByText('Repositories'));
    await user.click(
      screen.getByRole('button', { name: 'Enable context group' }),
    );

    await waitFor(() =>
      expect(mockAlertPost).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Created 0 context groups, updated 1',
        }),
      ),
    );
  });

  it('reports applying state to the host and toasts on failure', async () => {
    const user = userEvent.setup();
    mockListContextGroupSeeds.mockResolvedValue({ data: [makeSeed()] });
    mockApplyContextGroupSeeds.mockRejectedValue(new Error('nope'));
    const onApplyingChange = vi.fn();

    render(
      <ContextGroupSeedPicker
        onComplete={vi.fn()}
        onCreateCustom={vi.fn()}
        onApplyingChange={onApplyingChange}
      />,
    );

    await user.click(await screen.findByText('Repositories'));
    await user.click(
      screen.getByRole('button', { name: 'Enable context group' }),
    );

    await waitFor(() =>
      expect(mockAlertPost).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      ),
    );
    expect(onApplyingChange).toHaveBeenNthCalledWith(1, true);
    expect(onApplyingChange).toHaveBeenLastCalledWith(false);
  });

  it('renders a created, up-to-date seed struck through and navigates to it on click', async () => {
    const user = userEvent.setup();
    mockListContextGroupSeeds.mockResolvedValue({
      data: [makeSeed({ created: true, ruleId: 'rule-1' })],
    });
    const onClose = vi.fn();

    render(
      <ContextGroupSeedPicker
        onComplete={vi.fn()}
        onCreateCustom={vi.fn()}
        onClose={onClose}
        variant="compact"
      />,
    );

    const name = await screen.findByText('Repositories');
    expect(name).toHaveClass('line-through');
    // With nothing selectable, no select-all header renders.
    expect(screen.queryByText(/Select all/)).not.toBeInTheDocument();

    await user.click(name);
    expect(mockNavigate).toHaveBeenCalledWith('/context-groups/rule-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps a seed with an available update selectable', async () => {
    const user = userEvent.setup();
    mockListContextGroupSeeds.mockResolvedValue({
      data: [
        makeSeed({ created: true, ruleId: 'rule-1', updateAvailable: true }),
      ],
    });
    mockApplyContextGroupSeeds.mockResolvedValue({
      data: { created: 0, updated: 1, skipped: 0, unresolved: 0 },
    });

    render(
      <ContextGroupSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
    );

    expect(await screen.findByText('Update available')).toBeInTheDocument();
    await user.click(screen.getByText('Repositories'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Enable context group' }),
    ).toBeEnabled();
  });

  it('fires onCreateCustom from the custom row', async () => {
    const user = userEvent.setup();
    mockListContextGroupSeeds.mockResolvedValue({ data: [makeSeed()] });
    const onCreateCustom = vi.fn();

    render(
      <ContextGroupSeedPicker
        onComplete={vi.fn()}
        onCreateCustom={onCreateCustom}
      />,
    );

    await user.click(
      await screen.findByRole('button', {
        name: /Create custom context group/,
      }),
    );

    expect(onCreateCustom).toHaveBeenCalled();
  });

  it('shows an error state with retry and custom escape hatch', async () => {
    mockListContextGroupSeeds.mockRejectedValue(new Error('boom'));

    render(
      <ContextGroupSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
    );

    expect(
      await screen.findByText(
        'Failed to load context group templates. Please try again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Create custom context group/ }),
    ).toBeInTheDocument();
  });

  it('select-all toggles every selectable seed', async () => {
    const user = userEvent.setup();
    mockListContextGroupSeeds.mockResolvedValue({
      data: [
        makeSeed(),
        makeSeed({ name: 'People', slug: 'people' }),
        makeSeed({ name: 'Teams', slug: 'teams', created: true, ruleId: 'r3' }),
      ],
    });

    render(
      <ContextGroupSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
    );

    await user.click(await screen.findByText('Select all (2)'));

    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });
});
