import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Link } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { CapabilityEditor } from './capability-editor';
import { createTestQueryClient } from '../../../test-utils';

const mockAlertApi = { post: vi.fn() };
const mockCapabilitiesApi = {
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listVersions: vi.fn(),
  restoreVersion: vi.fn(),
};
vi.mock('../../../api', () => ({
  useCapabilities: () => mockCapabilitiesApi,
  useAlert: () => mockAlertApi,
}));

// The reference list aggregates three feature data hooks; stub it so these
// tests stay off the network/query layer.
vi.mock('./use-capability-references', () => ({
  useCapabilityReferences: () => ({
    references: [],
    byKey: new Map(),
    loading: false,
  }),
}));

// CodeMirror doesn't run in jsdom; a plain textarea preserves the
// value/onChange contract the editor relies on.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
  }) => (
    // eslint-disable-next-line react/forbid-elements -- native stand-in for CodeMirror in jsdom
    <textarea
      aria-label="Instructions"
      value={value}
      readOnly={readOnly}
      onChange={e => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

function makeCapability(over: {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  instructions?: string;
}) {
  return {
    id: over.id,
    slug: over.slug ?? over.name.toLowerCase(),
    name: over.name,
    description: over.description ?? `${over.name} description`,
    instructions: over.instructions ?? `${over.name} instructions`,
    currentVersion: 1,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-20T00:00:00Z',
  };
}

const capA = makeCapability({ id: 'cap-a', name: 'Alpha' });
const capB = makeCapability({ id: 'cap-b', name: 'Beta' });

function makeVersion(over: {
  version: number;
  name: string;
  description?: string;
  instructions?: string;
}) {
  return {
    id: `v-${over.version}`,
    capabilityId: 'cap-a',
    slug: 'alpha',
    version: over.version,
    name: over.name,
    description: over.description ?? `${over.name} description`,
    instructions: over.instructions ?? `${over.name} instructions`,
    createdAt: '2026-06-01T00:00:00Z',
  };
}

function renderEditor(initialPath: string) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Link to="/capabilities/cap-a">Go A</Link>
        <Link to="/capabilities/cap-b">Go B</Link>
        <Link to="/capabilities/new">Go New</Link>
        <Routes>
          <Route
            path="/capabilities/:capabilityId"
            element={<CapabilityEditor />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const draftKey = (id: string) => `capabilities:editor-draft:${id}`;

// The capability name is the editable header title: a button (editable) or an
// <h1> (read-only, e.g. version view). Empty shows the "Untitled capability"
// placeholder.
// The markdown preview also renders an <h1>; the header's comes first in the DOM.
function nameText(): string {
  const trigger = screen.queryByTestId('editable-title-trigger');
  return (
    (trigger ?? screen.getAllByRole('heading', { level: 1 })[0]).textContent ??
    ''
  );
}

async function setName(
  user: ReturnType<typeof userEvent.setup>,
  value: string,
) {
  await user.click(screen.getByTestId('editable-title-trigger'));
  const input = screen.getByLabelText('Edit title');
  await user.clear(input);
  await user.type(input, `${value}{Enter}`);
}

// Slug and description live in the header slug popover.
async function openSlugPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('capability-slug-trigger'));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockCapabilitiesApi.get.mockImplementation(async (id: string) =>
    id === 'cap-a' ? capA : id === 'cap-b' ? capB : undefined,
  );
  mockCapabilitiesApi.listVersions.mockResolvedValue({ items: [], total: 0 });
});

describe('CapabilityEditor', () => {
  describe('header identity fields', () => {
    it('shows name and description in the header and the slug in the popover', async () => {
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });
      expect(
        screen.getByTestId('editable-description-trigger'),
      ).toHaveTextContent('Alpha description');
      expect(screen.getByTestId('capability-slug-trigger')).toHaveTextContent(
        'alpha',
      );
      await openSlugPopover(user);
      expect(screen.getByLabelText('Slug')).toHaveValue('alpha');
      expect(screen.getByLabelText('Instructions')).toHaveValue(
        'Alpha instructions',
      );
    });

    it('saves a description still being edited when Save is clicked directly', async () => {
      mockCapabilitiesApi.update.mockResolvedValue(capA);
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      await user.click(screen.getByTestId('editable-description-trigger'));
      const input = screen.getByLabelText('Edit description');
      await user.clear(input);
      await user.type(input, 'Mid-edit description');
      // No Enter/blur — clicking Save must commit the in-progress edit first.
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockCapabilitiesApi.update).toHaveBeenCalledWith(
          'cap-a',
          expect.objectContaining({ description: 'Mid-edit description' }),
        );
      });
    });

    it('edits the description inline from the header subtitle', async () => {
      mockCapabilitiesApi.update.mockResolvedValue(capA);
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      await user.click(screen.getByTestId('editable-description-trigger'));
      const input = screen.getByLabelText('Edit description');
      await user.clear(input);
      await user.type(input, 'New description{Enter}');

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(mockCapabilitiesApi.update).toHaveBeenCalledWith(
          'cap-a',
          expect.objectContaining({ description: 'New description' }),
        );
      });
    });
  });

  describe('keyed remount across capabilities', () => {
    it('shows the other record cleanly after switching, with no field leakage', async () => {
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      await setName(user, 'Alpha edited');
      expect(nameText()).toBe('Alpha edited');

      await user.click(screen.getByRole('link', { name: 'Go B' }));
      await waitFor(() => {
        expect(nameText()).toBe('Beta');
      });
      expect(
        screen.getByTestId('editable-description-trigger'),
      ).toHaveTextContent('Beta description');
      // B was never edited, so it is not dirty and Save stays disabled.
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('resets to an empty form when switching from a record to /new', async () => {
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      await user.click(screen.getByRole('link', { name: 'Go New' }));
      expect(nameText()).toBe('Untitled capability');
      expect(screen.getByLabelText('Instructions')).toHaveValue('');
    });
  });

  describe('draft persistence', () => {
    it('persists edits and restores the draft when returning to the capability', async () => {
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      await setName(user, 'Alpha edited');
      await waitFor(() => {
        const raw = sessionStorage.getItem(draftKey('cap-a'));
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw as string).name).toBe('Alpha edited');
      });

      // Navigate away (remounts the form for B) and back to A.
      await user.click(screen.getByRole('link', { name: 'Go B' }));
      await waitFor(() => {
        expect(nameText()).toBe('Beta');
      });
      await user.click(screen.getByRole('link', { name: 'Go A' }));

      await waitFor(() => {
        expect(nameText()).toBe('Alpha edited');
      });
      // The restored draft counts as dirty, so Save is enabled.
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('restores a persisted draft for a new capability on mount', () => {
      sessionStorage.setItem(
        draftKey('new'),
        JSON.stringify({
          name: 'Draft name',
          description: 'Draft desc',
          instructions: 'Draft instructions',
        }),
      );
      renderEditor('/capabilities/new');
      expect(nameText()).toBe('Draft name');
      expect(screen.getByLabelText('Instructions')).toHaveValue(
        'Draft instructions',
      );
    });

    it('does not persist a pristine existing capability', async () => {
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });
      expect(sessionStorage.getItem(draftKey('cap-a'))).toBeNull();
    });

    it('ignores a non-meaningful stored draft for an existing capability', async () => {
      sessionStorage.setItem(
        draftKey('cap-a'),
        JSON.stringify({ name: '', description: '', instructions: '' }),
      );
      renderEditor('/capabilities/cap-a');

      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });
      expect(sessionStorage.getItem(draftKey('cap-a'))).toBeNull();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('preserves unsaved edits when exiting a version view', async () => {
      mockCapabilitiesApi.get.mockResolvedValue({
        ...capA,
        currentVersion: 2,
      });
      mockCapabilitiesApi.listVersions.mockResolvedValue({
        items: [makeVersion({ version: 1, name: 'Old Name' })],
        total: 2,
      });
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      await setName(user, 'Edited Name');
      await user.click(screen.getByRole('button', { name: 'History' }));
      await user.click(screen.getByRole('button', { name: /v1/ }));
      expect(nameText()).toBe('Old Name');

      await user.click(screen.getByRole('button', { name: /Exit/ }));

      expect(nameText()).toBe('Edited Name');
      const stored = sessionStorage.getItem(draftKey('cap-a'));
      expect(JSON.parse(stored as string).name).toBe('Edited Name');
    });

    it('clears the stored draft after a successful save', async () => {
      mockCapabilitiesApi.update.mockResolvedValue(capA);
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      await setName(user, 'Alpha edited');
      await waitFor(() => {
        expect(sessionStorage.getItem(draftKey('cap-a'))).toBeTruthy();
      });

      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockCapabilitiesApi.update).toHaveBeenCalledWith(
          'cap-a',
          expect.objectContaining({ name: 'Alpha edited' }),
        );
      });
      expect(sessionStorage.getItem(draftKey('cap-a'))).toBeNull();
    });

    it('discards edits back to the saved capability after confirming', async () => {
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      // Discard is present but disabled while there's nothing to discard.
      expect(screen.getByTestId('capability-discard')).toBeDisabled();

      await setName(user, 'Alpha edited');
      const instructions = screen.getByLabelText('Instructions');
      await user.clear(instructions);
      await user.type(instructions, 'edited body');
      await waitFor(() => {
        expect(sessionStorage.getItem(draftKey('cap-a'))).toBeTruthy();
      });
      expect(screen.getByTestId('capability-discard')).toBeEnabled();

      await user.click(screen.getByTestId('capability-discard'));
      const dialog = screen.getByTestId('confirmation-dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });
      expect(screen.getByLabelText('Instructions')).toHaveValue(
        'Alpha instructions',
      );
      // Reverted to the saved baseline: not dirty, no persisted draft, both
      // Save and Discard disabled again.
      expect(sessionStorage.getItem(draftKey('cap-a'))).toBeNull();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(screen.getByTestId('capability-discard')).toBeDisabled();
    });

    it('keeps edits when the discard confirmation is cancelled', async () => {
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(nameText()).toBe('Alpha');
      });

      await setName(user, 'Alpha edited');
      await user.click(screen.getByTestId('capability-discard'));
      const dialog = screen.getByTestId('confirmation-dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(nameText()).toBe('Alpha edited');
      expect(screen.getByTestId('capability-discard')).toBeEnabled();
    });

    it('does not show a Discard button while creating a capability', async () => {
      const user = userEvent.setup();
      renderEditor('/capabilities/new');
      expect(nameText()).toBe('Untitled capability');

      // Even once the new form is dirty, there's no saved state to revert to.
      await setName(user, 'Brand new');
      expect(screen.queryByTestId('capability-discard')).toBeNull();
    });

    it('persists instructions verbatim without trimming surrounding whitespace', async () => {
      mockCapabilitiesApi.update.mockResolvedValue(capA);
      const user = userEvent.setup();
      renderEditor('/capabilities/cap-a');
      await waitFor(() => {
        expect(screen.getByLabelText('Instructions')).toHaveValue(
          'Alpha instructions',
        );
      });

      const instructions = screen.getByLabelText('Instructions');
      await user.clear(instructions);
      await user.type(instructions, '  spaced body  ');

      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockCapabilitiesApi.update).toHaveBeenCalledWith(
          'cap-a',
          // Whitespace preserved — trimming would silently mutate the markdown.
          expect.objectContaining({ instructions: '  spaced body  ' }),
        );
      });
    });
  });
});
