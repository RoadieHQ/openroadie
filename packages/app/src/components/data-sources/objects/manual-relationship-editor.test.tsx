import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { renderWithQuery } from '../../../test-utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualRelationshipEditor } from './manual-relationship-editor';
import type { ObjectRelationship } from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';

const mockCreateRelationship = vi.fn();
const mockDeleteRelationship = vi.fn();
const mockGetObject = vi.fn();
const mockListRelationshipRules = vi.fn();
const mockAlertPost = vi.fn();

vi.mock('../../../api', () => ({
  useDatastore: () => ({
    createRelationship: mockCreateRelationship,
    deleteRelationship: mockDeleteRelationship,
    getObject: mockGetObject,
    listRelationshipRules: mockListRelationshipRules,
    materializeContextGroupsForDatasource: vi.fn().mockResolvedValue(undefined),
  }),
  useAlert: () => ({ post: mockAlertPost }),
}));

const mockUseDataSourceObjects = vi.fn();
vi.mock('./use-data-source-objects', () => ({
  useDataSourceObjects: (...args: unknown[]) =>
    mockUseDataSourceObjects(...args),
}));

const dataSources = [
  { id: 'ds-2', name: 'Jira Issues' },
  { id: 'ds-3', name: 'GitHub Repositories' },
] as DataSourceItem[];

function render(
  props: Partial<React.ComponentProps<typeof ManualRelationshipEditor>> = {},
) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithQuery(
    <MemoryRouter>
      <ManualRelationshipEditor
        variant="page"
        open
        sourceDatasourceId="ds-1"
        sourceObjectId="obj-1"
        sourceLabel="Object One"
        dataSources={dataSources}
        existingRelationships={[]}
        onClose={onClose}
        onSaved={onSaved}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onClose, onSaved };
}

async function pickTarget(user: ReturnType<typeof userEvent.setup>) {
  // The Target panel opens on its data-source config; picking the data source
  // auto-flips the panel to its object list.
  await user.click(
    screen.getByRole('combobox', { name: /target data source/i }),
  );
  await user.click(await screen.findByRole('option', { name: 'Jira Issues' }));
  await user.click(await screen.findByRole('button', { name: /team-a/i }));
}

async function setType(user: ReturnType<typeof userEvent.setup>, type: string) {
  // The Match panel opens on its config, so the type field is already present;
  // if a test closed it, reopen via the cogwheel.
  const cog = screen.queryByRole('button', { name: /configure match/i });
  if (cog) {
    await user.click(cog);
  }
  const field = screen.getByRole('combobox', { name: /^relationship type$/i });
  await user.clear(field);
  await user.type(field, type);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateRelationship.mockResolvedValue({ id: 'rel-1' });
  mockDeleteRelationship.mockResolvedValue(undefined);
  mockGetObject.mockResolvedValue({
    object: { name: 'Team A', kind: 'Group' },
    relationships: [],
  });
  // The manual type list draws from existing rules' types (same as the rule editor).
  mockListRelationshipRules.mockResolvedValue({
    items: [{ id: 'rule-1', relationshipType: 'sameIdentityAs' }],
    total: 1,
  });
  mockUseDataSourceObjects.mockReturnValue({
    rows: [
      {
        id: 'r1',
        datasourceId: 'ds-2',
        objectId: 'team-a',
        object: { name: 'Team A' },
        indexValues: new Map(),
        createdAt: '',
        updatedAt: '',
      },
    ],
    loading: false,
    total: 1,
  });
});

describe('ManualRelationshipEditor', () => {
  it('keeps Add disabled until a target and type are set, then creates with the derived reverse verb', async () => {
    const user = userEvent.setup();
    const { onSaved } = render();

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

    await pickTarget(user);
    await setType(user, 'ownedBy');

    const add = screen.getByRole('button', { name: 'Create' });
    expect(add).toBeEnabled();
    await user.click(add);

    await waitFor(() =>
      expect(mockCreateRelationship).toHaveBeenCalledWith({
        sourceDatasourceId: 'ds-1',
        sourceObjectId: 'obj-1',
        destinationDatasourceId: 'ds-2',
        destinationObjectId: 'team-a',
        relationshipType: 'ownedBy',
        reciprocalRelationshipType: 'owns',
        origin: 'manual',
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockAlertPost).toHaveBeenCalledWith({
      message: 'Direct relationship added',
      severity: 'success',
    });
  });

  it('renders the source→target step map with the source object preview', async () => {
    render();
    // Source endpoint label appears (step-map node + shell header endpoint).
    expect(screen.getAllByText('Object One').length).toBeGreaterThan(0);
    // The Source object preview tree renders the fetched object's fields.
    expect(await screen.findAllByText('kind')).not.toHaveLength(0);
    expect(mockGetObject).toHaveBeenCalledWith('ds-1', 'obj-1');
  });

  it('opens Match and Target in configuration and flags incomplete stages with cogwheel dots', async () => {
    const user = userEvent.setup();
    render();

    // Both open on their configuration by default.
    expect(
      screen.getByRole('combobox', { name: /^relationship type$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /target data source/i }),
    ).toBeInTheDocument();
    // Incomplete Match/Target stages surface a warning dot on their cogwheel.
    expect(
      screen.getByLabelText('Pick a relationship type'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Pick a data source')).toBeInTheDocument();

    // The Match step in the map is clickable and toggles its configuration.
    await user.click(screen.getByRole('button', { name: 'Match' }));
    expect(
      screen.queryByRole('combobox', { name: /^relationship type$/i }),
    ).toBeNull();
  });

  it('offers relationship types used by existing rules (not just this object)', async () => {
    const user = userEvent.setup();
    render();
    // The Match panel opens on its config, so the type field is already shown.
    const field = screen.getByRole('combobox', {
      name: /^relationship type$/i,
    });
    await user.click(field);
    await user.type(field, 'same');
    expect(
      await screen.findByRole('option', { name: /sameIdentityAs/i }),
    ).toBeInTheDocument();
  });

  it('omits the reverse verb when the type has no known inverse and it is blank', async () => {
    const user = userEvent.setup();
    render();
    await pickTarget(user);
    await setType(user, 'linkedTo');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mockCreateRelationship).toHaveBeenCalledWith({
        sourceDatasourceId: 'ds-1',
        sourceObjectId: 'obj-1',
        destinationDatasourceId: 'ds-2',
        destinationObjectId: 'team-a',
        relationshipType: 'linkedTo',
        origin: 'manual',
      }),
    );
  });

  it('blocks save for a duplicate of an existing outgoing relationship', async () => {
    const user = userEvent.setup();
    const existing = [
      {
        id: 'rel-x',
        direction: 'outgoing',
        sourceDatasourceId: 'ds-1',
        sourceObjectId: 'obj-1',
        destinationDatasourceId: 'ds-2',
        destinationObjectId: 'team-a',
        relationshipType: 'ownedBy',
        origin: 'manual',
      },
    ] as ObjectRelationship[];
    render({ existingRelationships: existing });

    await pickTarget(user);
    await setType(user, 'ownedBy');

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(mockCreateRelationship).not.toHaveBeenCalled();
  });

  it('surfaces API failures without closing', async () => {
    const user = userEvent.setup();
    mockCreateRelationship.mockRejectedValue(new Error('boom'));
    const { onSaved } = render();
    await pickTarget(user);
    await setType(user, 'ownedBy');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('edits by creating the new edge then deleting the old one when the tuple changes', async () => {
    const user = userEvent.setup();
    const relationship = {
      id: 'rel-9',
      direction: 'outgoing',
      sourceDatasourceId: 'ds-1',
      sourceObjectId: 'obj-1',
      destinationDatasourceId: 'ds-2',
      destinationObjectId: 'team-a',
      relationshipType: 'ownedBy',
      origin: 'manual',
    } as ObjectRelationship;
    render({ relationship });

    // Prefilled from the row; change the type so the tuple changes.
    await setType(user, 'partOf');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationDatasourceId: 'ds-2',
          destinationObjectId: 'team-a',
          relationshipType: 'partOf',
          reciprocalRelationshipType: 'hasPart',
          origin: 'manual',
        }),
      ),
    );
    await waitFor(() =>
      expect(mockDeleteRelationship).toHaveBeenCalledWith('rel-9'),
    );
  });

  it('deletes the relationship via the Delete button without recreating it', async () => {
    const user = userEvent.setup();
    const relationship = {
      id: 'rel-9',
      direction: 'outgoing',
      sourceDatasourceId: 'ds-1',
      sourceObjectId: 'obj-1',
      destinationDatasourceId: 'ds-2',
      destinationObjectId: 'team-a',
      relationshipType: 'ownedBy',
      origin: 'manual',
    } as ObjectRelationship;
    const { onSaved } = render({ relationship });

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // The delete path only removes the edge — it must not create a replacement.
    await waitFor(() =>
      expect(mockDeleteRelationship).toHaveBeenCalledWith('rel-9'),
    );
    expect(mockCreateRelationship).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockAlertPost).toHaveBeenCalledWith({
      message: 'Direct relationship removed',
      severity: 'success',
    });
  });
});
