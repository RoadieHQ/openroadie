import React, { type ReactElement } from 'react';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { createTestQueryClient, renderWithQuery } from '../../../test-utils';
import { queryKeys } from '../../../api/queries';

import { DataSourceSeedPicker } from './data-source-seed-picker';
import type { DataSourceSeed } from '../../../api/workflow/workflow-client';

const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual =
    await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

// The picker navigates (useNavigate) when routing to an unconnected
// integration, so every render needs a Router in context.
const render = (ui: ReactElement) =>
  renderWithQuery(<MemoryRouter>{ui}</MemoryRouter>);

const mockListDataSourceSeeds = vi.fn();
const mockApplyDataSourceSeeds = vi.fn();
const mockListIntegrations = vi.fn();
const mockListLogos = vi.fn();
const mockAlertPost = vi.fn();

// Stable references so the data hooks don't re-fire on every render
const stableApi = {
  workflows: {
    listDataSourceSeeds: mockListDataSourceSeeds,
    applyDataSourceSeeds: mockApplyDataSourceSeeds,
  },
  integrations: {
    list: mockListIntegrations,
    listLogos: mockListLogos,
  },
};
const stableAlert = { post: mockAlertPost };

vi.mock('../../../api', () => ({
  useWorkflows: () => stableApi,
  useAlert: () => stableAlert,
}));

function makeSeed(overrides?: Partial<DataSourceSeed>): DataSourceSeed {
  return {
    name: 'GitHub Repositories',
    description: 'Repos from GitHub',
    integrationSlug: 'github-token',
    integrationConfigured: true,
    created: false,
    ...overrides,
  };
}

function setupApi(seeds: DataSourceSeed[]) {
  mockListDataSourceSeeds.mockResolvedValue({ data: seeds });
  mockListIntegrations.mockResolvedValue({
    data: [
      {
        id: 'int-gh',
        name: 'GitHub',
        slug: 'github-token',
        logoUrl: '',
        logoSlug: 'github',
      },
      {
        id: 'int-pd',
        name: 'PagerDuty',
        slug: 'pagerduty',
        logoUrl: '',
        logoSlug: 'pagerduty',
      },
    ],
  });
  mockListLogos.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DataSourceSeedPicker', () => {
  it('refreshes integration metadata independently of the seed catalog', async () => {
    setupApi([
      makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
    ]);
    const queryClient = createTestQueryClient();

    rtlRender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DataSourceSeedPicker onComplete={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('GitHub')).toBeInTheDocument());

    mockListIntegrations.mockResolvedValue({
      data: [
        {
          id: 'int-gh',
          name: 'GitHub Enterprise',
          slug: 'github-token',
          logoUrl: '',
          logoSlug: 'github',
        },
      ],
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.integrationsList,
    });

    await waitFor(() =>
      expect(screen.getByText('GitHub Enterprise')).toBeInTheDocument(),
    );
  });

  describe('inline variant (empty state)', () => {
    it('renders integration groups when data sources are empty', async () => {
      const seeds = [
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
        makeSeed({
          name: 'PagerDuty Services',
          integrationSlug: 'pagerduty',
        }),
      ];
      setupApi(seeds);

      render(
        <DataSourceSeedPicker onComplete={vi.fn()} onCreateCustom={vi.fn()} />,
      );

      await waitFor(() => {
        expect(
          screen.getByText('Get started with data sources'),
        ).toBeInTheDocument();
      });

      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('PagerDuty')).toBeInTheDocument();
    });

    it('shows loading skeletons while fetching seeds', () => {
      mockListDataSourceSeeds.mockReturnValue(new Promise(() => {}));
      mockListIntegrations.mockReturnValue(new Promise(() => {}));
      mockListLogos.mockReturnValue(new Promise(() => {}));

      const { container } = render(
        <DataSourceSeedPicker onComplete={vi.fn()} />,
      );

      expect(container.querySelector('.motion-skeleton')).toBeInTheDocument();
    });
  });

  describe('compact variant (modal)', () => {
    it('renders sidebar with integration list and seed list for active integration', async () => {
      const user = userEvent.setup();
      const onCreateIntegration = vi.fn();
      const seeds = [
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
        makeSeed({ name: 'GitHub Teams', integrationSlug: 'github-token' }),
        makeSeed({
          name: 'PagerDuty Services',
          integrationSlug: 'pagerduty',
        }),
      ];
      setupApi(seeds);

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onCreateCustom={vi.fn()}
          onCreateIntegration={onCreateIntegration}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('New data source')).toBeTruthy();
      });

      expect(screen.getByText('GitHub')).toBeTruthy();
      expect(screen.getByText('PagerDuty')).toBeTruthy();

      expect(screen.getByText('GitHub Repos')).toBeTruthy();
      expect(screen.getByText('GitHub Teams')).toBeTruthy();
      expect(
        screen.getByRole('button', {
          name: 'Add custom data source',
        }),
      ).toBeTruthy();
      expect(
        screen.getByRole('button', {
          name: 'Add new integration',
        }),
      ).toBeTruthy();

      await user.click(screen.getByText('PagerDuty'));

      expect(screen.getByText('PagerDuty Services')).toBeTruthy();
      expect(
        screen.getAllByRole('button', {
          name: 'Add custom data source',
        }).length,
      ).toBeGreaterThan(0);
      await user.click(
        screen.getByRole('button', {
          name: 'Add new integration',
        }),
      );
      expect(onCreateIntegration).toHaveBeenCalledTimes(1);
    });

    it('shows "No data sources selected" when nothing is picked', async () => {
      setupApi([
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
      ]);

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('No data sources selected')).toBeTruthy();
      });
    });

    it('labels the bottom-right action as "Enable data source"', async () => {
      setupApi([
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
      ]);

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Enable data source' }),
        ).toBeTruthy();
      });
    });

    it('creates a custom data source for the active integration when all seeds are already added', async () => {
      const user = userEvent.setup();
      const onCreateCustom = vi.fn();
      setupApi([
        makeSeed({
          name: 'GitHub Repos',
          integrationSlug: 'github-token',
          created: true,
        }),
      ]);

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onCreateCustom={onCreateCustom}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('No data sources selected')).toBeTruthy();
      });
      expect(
        screen.queryByText('All data sources have already been added.'),
      ).toBeNull();
      expect(
        screen.queryByText(
          'All templates added for GitHub. Add a custom data source instead.',
        ),
      ).toBeNull();

      const customButton = screen.getByRole('button', {
        name: 'Add custom data source',
      });
      expect(customButton.hasAttribute('disabled')).toBe(false);

      await user.click(customButton);

      expect(onCreateCustom).toHaveBeenCalledWith('int-gh');
    });

    it('opens an existing data source when clicking an already-added seed', async () => {
      const user = userEvent.setup();
      setupApi([
        makeSeed({
          name: 'GitHub Repos',
          integrationSlug: 'github-token',
          created: true,
          workflowId: 'ds-gh',
        }),
      ]);

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('GitHub Repos')).toBeTruthy();
      });

      await user.click(screen.getByText('GitHub Repos'));

      expect(mockNavigate).toHaveBeenCalledWith('/data-sources/ds-gh');
      expect(screen.getByText('No data sources selected')).toBeTruthy();
    });
  });

  describe('selecting and applying seeds', () => {
    it('selects a seed and applies it via the API', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      const seeds = [
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
        makeSeed({ name: 'GitHub Teams', integrationSlug: 'github-token' }),
      ];
      setupApi(seeds);
      mockApplyDataSourceSeeds.mockResolvedValue({
        data: { inserted: 1, skipped: [] },
      });

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={onComplete}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('GitHub Repos')).toBeInTheDocument();
      });

      await user.click(screen.getByText('GitHub Repos'));

      await waitFor(() => {
        expect(screen.getByText('1 data source selected')).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole('button', { name: 'Enable data source' }),
      );

      await waitFor(() => {
        expect(mockApplyDataSourceSeeds).toHaveBeenCalledWith(['GitHub Repos']);
      });
      expect(onComplete).toHaveBeenCalled();
      expect(mockAlertPost).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Created 1 data source',
          severity: 'success',
        }),
      );
    });

    it('allows selecting seeds across multiple integrations', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      const seeds = [
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
        makeSeed({
          name: 'PagerDuty Services',
          integrationSlug: 'pagerduty',
        }),
      ];
      setupApi(seeds);
      mockApplyDataSourceSeeds.mockResolvedValue({
        data: { inserted: 2, skipped: [] },
      });

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={onComplete}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('GitHub Repos')).toBeTruthy();
      });
      await user.click(screen.getByText('GitHub Repos'));

      await user.click(screen.getByText('PagerDuty'));
      await user.click(screen.getByText('PagerDuty Services'));

      await waitFor(() => {
        expect(screen.getByText('2 data sources selected')).toBeTruthy();
      });

      await user.click(
        screen.getByRole('button', { name: 'Enable data sources' }),
      );

      await waitFor(() => {
        expect(mockApplyDataSourceSeeds).toHaveBeenCalledWith(
          expect.arrayContaining(['GitHub Repos', 'PagerDuty Services']),
        );
      });
      expect(onComplete).toHaveBeenCalled();
    });

    it('does not allow selecting seeds already created', async () => {
      const user = userEvent.setup();
      const seeds = [
        makeSeed({
          name: 'GitHub Repos',
          integrationSlug: 'github-token',
          created: true,
          workflowId: 'ds-gh',
        }),
        makeSeed({
          name: 'GitHub Teams',
          integrationSlug: 'github-token',
          created: false,
        }),
      ];
      setupApi(seeds);

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('GitHub Repos')).toBeInTheDocument();
      });

      await user.click(screen.getByText('GitHub Repos'));

      expect(screen.getByText('No data sources selected')).toBeInTheDocument();

      await user.click(screen.getByText('GitHub Teams'));

      await waitFor(() => {
        expect(screen.getByText('1 data source selected')).toBeInTheDocument();
      });
    });

    it('clears selections after a successful apply', async () => {
      const user = userEvent.setup();
      setupApi([
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
        makeSeed({ name: 'GitHub Teams', integrationSlug: 'github-token' }),
      ]);
      mockApplyDataSourceSeeds.mockResolvedValue({
        data: { inserted: 1, skipped: [] },
      });

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('GitHub Repos')).toBeInTheDocument();
      });
      await user.click(screen.getByText('GitHub Repos'));
      await waitFor(() => {
        expect(screen.getByText('1 data source selected')).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole('button', { name: 'Enable data source' }),
      );

      await waitFor(() => {
        expect(
          screen.getByText('No data sources selected'),
        ).toBeInTheDocument();
      });
    });

    it('disables close and selection controls while applying and reports applying state', async () => {
      const user = userEvent.setup();
      const onApplyingChange = vi.fn();
      setupApi([
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
        makeSeed({ name: 'GitHub Teams', integrationSlug: 'github-token' }),
      ]);
      let resolveApply!: (value: unknown) => void;
      mockApplyDataSourceSeeds.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveApply = resolve;
          }),
      );

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
          onApplyingChange={onApplyingChange}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('GitHub Repos')).toBeInTheDocument();
      });
      await user.click(screen.getByText('GitHub Repos'));
      await user.click(
        screen.getByRole('button', { name: 'Enable data source' }),
      );

      expect(onApplyingChange).toHaveBeenCalledWith(true);
      const closeButton = screen.getByRole('button', { name: 'Close' });
      expect(closeButton).toBeDisabled();
      for (const checkbox of screen.getAllByRole('checkbox')) {
        expect(checkbox).toBeDisabled();
      }

      resolveApply({ data: { inserted: 1, skipped: [] } });

      await waitFor(() => {
        expect(onApplyingChange).toHaveBeenLastCalledWith(false);
      });
      expect(closeButton).toBeEnabled();
    });

    it('routes to the integration and posts an info alert when applying an unconnected seed', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      setupApi([
        makeSeed({
          name: 'PagerDuty Services',
          integrationSlug: 'pagerduty',
          integrationConfigured: false,
        }),
      ]);
      mockApplyDataSourceSeeds.mockResolvedValue({
        data: { inserted: 1, skipped: [] },
      });

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={onComplete}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('PagerDuty Services')).toBeInTheDocument();
      });
      await user.click(screen.getByText('PagerDuty Services'));
      await user.click(
        screen.getByRole('button', { name: 'Enable data source' }),
      );

      await waitFor(() => {
        expect(mockApplyDataSourceSeeds).toHaveBeenCalledWith([
          'PagerDuty Services',
        ]);
      });
      expect(onComplete).toHaveBeenCalled();
      expect(mockAlertPost).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Created 1 data source. Connect PagerDuty to start ingesting.',
          severity: 'info',
        }),
      );
    });
  });

  describe('connection state', () => {
    it('surfaces a connect hint for an unconnected integration group', async () => {
      const user = userEvent.setup();
      setupApi([
        makeSeed({
          name: 'GitHub Repos',
          integrationSlug: 'github-token',
          integrationConfigured: true,
        }),
        makeSeed({
          name: 'PagerDuty Services',
          integrationSlug: 'pagerduty',
          integrationConfigured: false,
        }),
      ]);

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      // GitHub is the default active group and is connected — no hint.
      await waitFor(() => {
        expect(screen.getByText('GitHub Repos')).toBeInTheDocument();
      });
      expect(
        screen.queryByRole('button', { name: /Connect/ }),
      ).not.toBeInTheDocument();

      // Switching to the unconnected PagerDuty group reveals the hint + CTA.
      await user.click(screen.getByText('PagerDuty'));
      expect(
        screen.getByText(/won't ingest until you connect it/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Connect/ }),
      ).toBeInTheDocument();
    });

    it('supports select all per integration', async () => {
      const user = userEvent.setup();
      const seeds = [
        makeSeed({ name: 'GitHub Repos', integrationSlug: 'github-token' }),
        makeSeed({ name: 'GitHub Teams', integrationSlug: 'github-token' }),
        makeSeed({ name: 'GitHub Users', integrationSlug: 'github-token' }),
      ];
      setupApi(seeds);

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Select all (3)')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Select all (3)'));

      await waitFor(() => {
        expect(screen.getByText('3 data sources selected')).toBeInTheDocument();
      });
    });

    it('sorts seeds alphabetically within an integration group', async () => {
      setupApi([
        makeSeed({ name: 'AWS WAFv2 Web ACLs', integrationSlug: 'aws' }),
        makeSeed({ name: 'AWS EKS clusters', integrationSlug: 'aws' }),
        makeSeed({ name: 'AWS ACM certificates', integrationSlug: 'aws' }),
        makeSeed({ name: 'AWS accounts', integrationSlug: 'aws' }),
        makeSeed({ name: 'AWS App Runner services', integrationSlug: 'aws' }),
      ]);
      mockListIntegrations.mockResolvedValue({
        data: [
          {
            id: 'int-aws',
            name: 'AWS',
            slug: 'aws',
            logoUrl: '',
            logoSlug: 'aws',
          },
        ],
      });

      render(
        <DataSourceSeedPicker
          variant="compact"
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('AWS accounts')).toBeInTheDocument();
      });

      const labels = screen
        .getAllByRole('button')
        .map(el => el.textContent?.replace(/\s+/g, ' ').trim())
        .filter(
          (text): text is string =>
            typeof text === 'string' && text.startsWith('AWS '),
        );
      expect(labels).toEqual([
        'AWS accounts',
        'AWS ACM certificates',
        'AWS App Runner services',
        'AWS EKS clusters',
        'AWS WAFv2 Web ACLs',
      ]);
    });
  });
});
