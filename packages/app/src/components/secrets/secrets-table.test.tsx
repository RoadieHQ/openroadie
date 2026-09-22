import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { SecretsTable } from './secrets-table';
import { SecretStatusType } from '../../api/secrets';
import type { Secret } from '../../api/secrets';
import { TestQueryProvider } from '../../test-utils';

const mockGetKeys = vi.fn();
const mockAlertApi = { post: vi.fn() };

vi.mock('../../api', () => ({
  useSecrets: () => ({ getKeys: mockGetKeys }),
  useAlert: () => mockAlertApi,
}));

vi.mock('./secret-settings-context', () => ({
  SecretSettingsContext: React.createContext({
    reloadSignal: 0,
    triggerReload: () => {},
    storageMode: undefined,
    readOnly: false,
    loading: false,
  }),
  useSecretSettings: () => ({
    reloadSignal: 0,
    triggerReload: () => {},
    storageMode: undefined,
    readOnly: false,
    loading: false,
  }),
}));

vi.mock('./add-secret-button', () => ({
  AddSecretButton: () => <span>Add Secret</span>,
}));

vi.mock('./edit-secret-button', () => ({
  EditSecretButton: ({ secret }: { secret: Secret }) => (
    <span>Edit {secret.name}</span>
  ),
}));

function makeSecret(overrides?: Partial<Secret>): Secret {
  return {
    name: 'GITHUB_TOKEN',
    value: '',
    description: 'GitHub personal access token',
    status: SecretStatusType.Available,
    helpUrl: 'https://docs.example.com/github',
    createdAt: '2026-03-18T10:30:00Z',
    lastModified: '2026-03-20T10:30:00Z',
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current search params">{location.search}</output>;
}

function renderTable(initialEntry = '/secrets') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TestQueryProvider>
        <SecretsTable />
        <LocationProbe />
      </TestQueryProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SecretsTable', () => {
  describe('rendering', () => {
    it('shows skeleton while loading', () => {
      vi.useFakeTimers();
      try {
        mockGetKeys.mockReturnValue(new Promise(() => {}));
        const { container } = renderTable();
        // Skeleton is delay-gated (anti-flicker) — it appears shortly after mount.
        act(() => {
          vi.advanceTimersByTime(200);
        });
        expect(container.querySelector('.motion-skeleton')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows error message on fetch failure', async () => {
      mockGetKeys.mockRejectedValue(new Error('Network failure'));
      renderTable();
      expect(
        await screen.findByText('Unable to display secrets'),
      ).toBeInTheDocument();
      expect(screen.getByText('Network failure')).toBeInTheDocument();
    });

    it('shows empty message when no secrets configured', async () => {
      mockGetKeys.mockResolvedValue([]);
      renderTable();
      await waitFor(() => {
        expect(screen.getByText('No secrets configured')).toBeInTheDocument();
      });
    });

    it('renders headers, secret rows, status badges, help link, and description', async () => {
      mockGetKeys.mockResolvedValue([
        makeSecret(),
        makeSecret({
          name: 'PAGERDUTY_API_KEY',
          description: 'PD key',
          status: SecretStatusType.Not_Set,
          helpUrl: undefined,
        }),
      ]);
      renderTable();
      await waitFor(() => {
        expect(screen.getByText('Name')).toBeInTheDocument();
      });
      expect(screen.getByText('Description')).toBeInTheDocument();
      expect(
        screen.getByRole('columnheader', { name: 'Status' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Created At')).toBeInTheDocument();
      expect(screen.getByText('Last Modified')).toBeInTheDocument();
      expect(screen.getByText('Help')).toBeInTheDocument();
      expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
      expect(screen.getByText('PAGERDUTY_API_KEY')).toBeInTheDocument();
      expect(screen.getByText('Configured')).toBeInTheDocument();
      expect(screen.getByText('Not set')).toBeInTheDocument();
      expect(
        screen.getByText('GitHub personal access token'),
      ).toBeInTheDocument();
      const link = screen.getByText('Docs').closest('a');
      expect(link).toHaveAttribute('href', 'https://docs.example.com/github');
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  describe('table controls', () => {
    it('stores search in the URL while filtering rows', async () => {
      const user = userEvent.setup();
      mockGetKeys.mockResolvedValue([
        makeSecret(),
        makeSecret({
          name: 'PAGERDUTY_API_KEY',
          status: SecretStatusType.Not_Set,
        }),
      ]);
      renderTable();
      await screen.findByText('GITHUB_TOKEN');

      await user.type(
        screen.getByRole('searchbox', { name: 'Search secrets' }),
        'PAGER',
      );

      expect(screen.queryByText('GITHUB_TOKEN')).not.toBeInTheDocument();
      expect(screen.getByText('PAGERDUTY_API_KEY')).toBeInTheDocument();
      expect(screen.getByLabelText('Current search params')).toHaveTextContent(
        '?search=PAGER',
      );
    });

    it('restores the status filter from the URL', async () => {
      const user = userEvent.setup();
      mockGetKeys.mockResolvedValue([
        makeSecret(),
        makeSecret({
          name: 'PAGERDUTY_API_KEY',
          status: SecretStatusType.Not_Set,
        }),
      ]);
      renderTable('/secrets?status=not-set');

      expect(await screen.findByText('PAGERDUTY_API_KEY')).toBeInTheDocument();
      expect(screen.queryByText('GITHUB_TOKEN')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Status' }));
      expect(
        await screen.findByRole('option', { name: /Not set/ }),
      ).toHaveAttribute('aria-selected', 'true');
    });

    it('offers persisted display options for non-primary columns', async () => {
      const user = userEvent.setup();
      window.localStorage.clear();
      mockGetKeys.mockResolvedValue([makeSecret()]);
      renderTable();
      await screen.findByText('GITHUB_TOKEN');

      await user.click(screen.getByRole('button', { name: 'Display columns' }));
      expect(
        screen.queryByRole('menuitemcheckbox', { name: 'Name' }),
      ).not.toBeInTheDocument();
      await user.click(
        screen.getByRole('menuitemcheckbox', { name: 'Description' }),
      );

      expect(
        screen.queryByRole('columnheader', { name: 'Description' }),
      ).not.toBeInTheDocument();
      window.localStorage.clear();
    });
  });
});
