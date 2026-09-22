import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { CapabilitiesPage } from './capabilities-page';
import { formatUpdated } from '../../overview';
import type { Capability } from '../../../api';

const mockAlertApi = { post: vi.fn() };
vi.mock('../../../api', () => ({
  useAlert: () => mockAlertApi,
}));

const mockDeleteCapability = vi.fn();
const mockRetry = vi.fn();
const mockUseCapabilities = vi.fn();
vi.mock('../use-capabilities', () => ({
  useCapabilities: () => mockUseCapabilities(),
}));

// The broken-reference indicator resolves `@type:slug` tokens against the
// resources that exist; stub the aggregator so the list tests don't pull in the
// data-source/action/context-group data hooks.
const mockUseCapabilityReferences = vi.fn();
vi.mock('../editor/use-capability-references', () => ({
  useCapabilityReferences: () => mockUseCapabilityReferences(),
}));

function setupReferences(
  byKey: Map<string, { type: string; slug: string; name: string }> = new Map(),
  loading = false,
) {
  mockUseCapabilityReferences.mockReturnValue({
    references: Array.from(byKey.values()),
    byKey,
    loading,
  });
}

function makeCapability(overrides?: Partial<Capability>): Capability {
  return {
    id: 'cap-1',
    slug: 'summarize',
    name: 'Summarize',
    description: 'Summarize text',
    instructions: 'Do the thing',
    currentVersion: 3,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    ...overrides,
  };
}

function setupHook(
  capabilities: Capability[] = [],
  { loading = false, error }: { loading?: boolean; error?: Error } = {},
) {
  mockUseCapabilities.mockReturnValue({
    capabilities,
    total: capabilities.length,
    loading,
    error,
    retry: mockRetry,
    deleteCapability: mockDeleteCapability,
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage(initialEntry = '/capabilities') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CapabilitiesPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function openActionsMenu(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: /actions/i }));
  await waitFor(() => {
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteCapability.mockResolvedValue(undefined);
  setupHook();
  setupReferences();
});

describe('CapabilitiesPage', () => {
  describe('rendering', () => {
    it('renders page header with title "Capabilities"', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: 'Capabilities' }),
      ).toBeInTheDocument();
    });

    it('renders the empty state when there are no capabilities', () => {
      renderPage();
      expect(screen.getByText('No capabilities yet')).toBeInTheDocument();
      expect(screen.getByText(/is a playbook for agents/)).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
      expect(screen.getByText('Context groups')).toBeInTheDocument();
      expect(screen.getByText('Data sources')).toBeInTheDocument();
      expect(
        screen.getByText('Summarize open pull requests'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('surfaces the error via a toast', () => {
      setupHook([], { error: new Error('Boom') });
      renderPage();
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Boom', severity: 'error' }),
      );
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('shows a load error state instead of the empty state', () => {
      setupHook([], { error: new Error('Boom') });
      renderPage();
      expect(
        screen.getByText('Failed to load capabilities'),
      ).toBeInTheDocument();
      expect(screen.queryByText('No capabilities yet')).not.toBeInTheDocument();
    });

    it('renders capabilities in a table with name, version, and updated date', () => {
      setupHook([
        makeCapability(),
        makeCapability({
          id: 'cap-2',
          name: 'Translate',
          currentVersion: 1,
          updatedAt: '2026-04-15T10:30:00Z',
        }),
      ]);
      renderPage();

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByTestId('capability-name-cap-1')).toHaveTextContent(
        'Summarize',
      );
      expect(screen.getByTestId('capability-name-cap-2')).toHaveTextContent(
        'Translate',
      );
      expect(screen.getByText('v3')).toBeInTheDocument();
      expect(screen.getByText('v1')).toBeInTheDocument();
      // Both rows can humanize to the same coarse "X ago" label, so scope the
      // assertion to cap-1's row instead of a page-wide text query.
      const cap1Row = screen.getByTestId('capability-name-cap-1').closest('tr');
      expect(cap1Row).not.toBeNull();
      expect(
        within(cap1Row!).getByText(formatUpdated('2026-03-20T10:30:00Z')!),
      ).toBeInTheDocument();
    });

    it('flags only capabilities with dangling references', () => {
      setupHook([
        makeCapability({
          id: 'cap-good',
          name: 'Healthy',
          instructions: 'Use @datasource:sentry-projects',
        }),
        makeCapability({
          id: 'cap-broken',
          name: 'Dangling',
          instructions: 'Calls @action:missing-action which was deleted',
        }),
      ]);
      // Only the Sentry data source resolves; the referenced action does not.
      setupReferences(
        new Map([
          [
            'datasource:sentry-projects',
            { type: 'datasource', slug: 'sentry-projects', name: 'Sentry' },
          ],
        ]),
      );
      renderPage();

      const badges = screen.getAllByTestId('capability-broken-references');
      expect(badges).toHaveLength(1);
      const brokenRow = screen
        .getByTestId('capability-name-cap-broken')
        .closest('tr');
      expect(
        within(brokenRow!).getByTestId('capability-broken-references'),
      ).toBeInTheDocument();
    });

    it('does not flag references while resources are still loading', () => {
      setupHook([
        makeCapability({
          id: 'cap-broken',
          name: 'Dangling',
          instructions: 'Calls @action:missing-action',
        }),
      ]);
      setupReferences(new Map(), /* loading */ true);
      renderPage();

      expect(
        screen.queryByTestId('capability-broken-references'),
      ).not.toBeInTheDocument();
    });
  });

  describe('search', () => {
    it('filters rows by name', async () => {
      const user = userEvent.setup();
      setupHook([
        makeCapability(),
        makeCapability({ id: 'cap-2', name: 'Translate' }),
      ]);
      renderPage();

      const search = screen.getByPlaceholderText('Search by name...');
      await user.type(search, 'Trans');

      await waitFor(() => {
        expect(
          screen.queryByTestId('capability-name-cap-1'),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByTestId('capability-name-cap-2')).toBeInTheDocument();
    });

    it('shows a no-match message when search matches nothing', async () => {
      const user = userEvent.setup();
      setupHook([makeCapability()]);
      renderPage();

      await user.type(
        screen.getByPlaceholderText('Search by name...'),
        'zzzzz',
      );

      await waitFor(() => {
        expect(
          screen.getByText('No matching capabilities'),
        ).toBeInTheDocument();
      });
    });
  });

  describe('navigation', () => {
    it('navigates to the new capability route from the New button', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: 'New Capability' }));
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/capabilities/new',
      );
    });

    it('navigates to the editor from the row Edit action', async () => {
      const user = userEvent.setup();
      setupHook([makeCapability()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /edit/i }));
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/capabilities/cap-1',
      );
    });
  });

  describe('detail drawer', () => {
    it('opens the detail drawer on row click', async () => {
      const user = userEvent.setup();
      setupHook([makeCapability()]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('capability-name-cap-1'));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Summarize')).toBeInTheDocument();
      expect(within(dialog).getByText('Summarize text')).toBeInTheDocument();
      expect(
        within(dialog).getByRole('link', { name: /open editor/i }),
      ).toHaveAttribute('href', '/capabilities/cap-1');
    });

    // The other half of the listing-navigation contract: the title is a link,
    // and following it must not also open the drawer.
    it('navigates to the capability when the title is clicked, without opening the drawer', async () => {
      const user = userEvent.setup();
      setupHook([makeCapability()]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      const title = screen.getByRole('link', { name: 'Summarize' });
      expect(title).toHaveAttribute('href', '/capabilities/cap-1');

      await user.click(title);

      expect(screen.getByTestId('location')).toHaveTextContent(
        '/capabilities/cap-1',
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('lists references and flags dangling ones in the drawer', async () => {
      const user = userEvent.setup();
      setupHook([
        makeCapability({
          instructions:
            'Read @datasource:sentry-projects then call @action:missing-action.',
        }),
      ]);
      // The Sentry data source resolves; the referenced action does not.
      setupReferences(
        new Map([
          [
            'datasource:sentry-projects',
            { type: 'datasource', slug: 'sentry-projects', name: 'Sentry' },
          ],
        ]),
      );
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('capability-name-cap-1'));

      const dialog = await screen.findByRole('dialog');
      // Resolved reference shows its display name; the dangling one is flagged
      // both in the header badge and as a "Missing <type>" row.
      expect(within(dialog).getByText('Sentry')).toBeInTheDocument();
      expect(within(dialog).getByText('Missing action')).toBeInTheDocument();
      expect(
        within(dialog).getByTestId('capability-broken-references'),
      ).toBeInTheDocument();
    });

    it('closes the detail drawer when clicking outside a row', async () => {
      const user = userEvent.setup();
      setupHook([makeCapability()]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('capability-name-cap-1'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();

      // Clicking a non-row element (the page heading) dismisses the drawer.
      await user.click(screen.getByRole('heading', { name: /capabilities/i }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('shows a not-found error for a stale detail URL', async () => {
      setupHook([makeCapability()]);
      renderPage('/capabilities?detail=missing-capability');

      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText('Capability not found.'),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('link', { name: /open editor/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('delete', () => {
    it('deletes a capability via the row action and confirmation dialog', async () => {
      const user = userEvent.setup();
      setupHook([makeCapability()]);
      renderPage();

      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText(/delete "Summarize"/i),
      ).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(mockDeleteCapability).toHaveBeenCalledWith('cap-1');
      });
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Capability deleted',
          severity: 'success',
        }),
      );
    });

    it('warns when another capability references the one being deleted', async () => {
      const user = userEvent.setup();
      setupHook([
        makeCapability(),
        makeCapability({
          id: 'cap-2',
          slug: 'triage',
          name: 'Triage',
          instructions: 'Delegate to @capability:summarize.',
        }),
      ]);
      renderPage();

      // Two rows means two Actions buttons — target the Summarize row's.
      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      await user.click(screen.getAllByRole('button', { name: /actions/i })[0]!);
      await user.click(
        await screen.findByRole('menuitem', { name: /delete/i }),
      );

      const dialog = await screen.findByRole('dialog');
      await waitFor(() => {
        expect(
          within(dialog).getByTestId('reference-usage-warning'),
        ).toBeInTheDocument();
      });
      expect(
        within(dialog).getByTestId('reference-usage-warning'),
      ).toHaveTextContent('Summarize — used by Triage');
    });

    it('does not warn when a mutually-referencing pair is deleted together', async () => {
      // Both references vanish with the capabilities that carry them, so
      // nothing that survives is broken.
      const user = userEvent.setup();
      setupHook([
        makeCapability({ instructions: 'Delegate to @capability:triage.' }),
        makeCapability({
          id: 'cap-2',
          slug: 'triage',
          name: 'Triage',
          instructions: 'Delegate to @capability:summarize.',
        }),
      ]);
      renderPage();

      const rowCheckboxes = await screen.findAllByRole('checkbox', {
        name: 'Select row',
      });
      await user.click(rowCheckboxes[0]!);
      await user.click(rowCheckboxes[1]!);
      await user.click(screen.getByRole('button', { name: '2 selected' }));
      await user.click(screen.getByRole('menuitem', { name: 'Delete 2' }));

      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).queryByTestId('reference-usage-warning'),
      ).not.toBeInTheDocument();
    });

    it('selects and deletes multiple capabilities', async () => {
      const user = userEvent.setup();
      setupHook([
        makeCapability(),
        makeCapability({ id: 'cap-2', name: 'Classify' }),
      ]);
      renderPage();

      const rowCheckboxes = await screen.findAllByRole('checkbox', {
        name: 'Select row',
      });
      await user.click(rowCheckboxes[0]!);
      await user.click(rowCheckboxes[1]!);
      await user.click(screen.getByRole('button', { name: '2 selected' }));
      await user.click(screen.getByRole('menuitem', { name: 'Delete 2' }));

      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText(/delete 2 capabilities/i),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(mockDeleteCapability).toHaveBeenNthCalledWith(1, 'cap-1');
        expect(mockDeleteCapability).toHaveBeenNthCalledWith(2, 'cap-2');
      });
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '2 capabilities deleted',
          severity: 'success',
        }),
      );
    });
  });
});
