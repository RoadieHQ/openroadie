import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../../../test-utils';
import { ObjectRelationshipsCard } from './object-relationships-card';
import type { ObjectRelationship } from '../../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../../types';

const mockGetObject = vi.fn();
const mockListRelationshipRules = vi.fn();
vi.mock('../../../../api', () => ({
  useDatastore: () => ({
    getObject: mockGetObject,
    listRelationshipRules: mockListRelationshipRules,
  }),
}));

const dataSources = [
  { id: 'ds-1', name: 'Source' },
  { id: 'ds-2', name: 'Target' },
] as DataSourceItem[];

// One editable edge (direct + outgoing) plus three that must NOT get an Edit
// affordance: a rule-derived outgoing edge, a manual *incoming* edge, and an
// outgoing edge materialized by a manually-authored rule (origin 'manual'
// but ruleId set — origin alone cannot distinguish it from a direct edge).
const relationships = [
  {
    id: 'm-out',
    origin: 'manual',
    ruleId: null,
    direction: 'outgoing',
    relationshipType: 'ownedBy',
    sourceDatasourceId: 'ds-1',
    sourceObjectId: 'o1',
    destinationDatasourceId: 'ds-2',
    destinationObjectId: 'team-a',
    metadata: { name: 'Team A' },
    createdAt: '',
    updatedAt: '',
    updatedBy: null,
  },
  {
    id: 'r-out',
    origin: 'rule',
    ruleId: 'rule-1',
    direction: 'outgoing',
    relationshipType: 'memberOf',
    sourceDatasourceId: 'ds-1',
    sourceObjectId: 'o1',
    destinationDatasourceId: 'ds-2',
    destinationObjectId: 'team-b',
    destinationObjectData: { fields: { name: 'Team B' } },
    metadata: null,
    createdAt: '',
    updatedAt: '',
    updatedBy: null,
  },
  {
    id: 'r-manual-origin',
    origin: 'manual',
    ruleId: 'rule-2',
    direction: 'outgoing',
    relationshipType: 'partOf',
    sourceDatasourceId: 'ds-1',
    sourceObjectId: 'o1',
    destinationDatasourceId: 'ds-2',
    destinationObjectId: 'team-c',
    metadata: { name: 'Team C' },
    createdAt: '',
    updatedAt: '',
    updatedBy: null,
  },
  {
    id: 'm-in',
    origin: 'manual',
    ruleId: null,
    direction: 'incoming',
    relationshipType: 'owns',
    sourceDatasourceId: 'ds-2',
    sourceObjectId: 'src',
    destinationDatasourceId: 'ds-1',
    destinationObjectId: 'o1',
    metadata: { name: 'Src' },
    createdAt: '',
    updatedAt: '',
    updatedBy: null,
  },
] as unknown as ObjectRelationship[];

function renderCard(
  props: Partial<React.ComponentProps<typeof ObjectRelationshipsCard>> = {},
) {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <ObjectRelationshipsCard
          relationships={relationships}
          dataSources={dataSources}
          {...props}
        />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetObject.mockResolvedValue({ object: { name: 'Fetched' } });
  mockListRelationshipRules.mockResolvedValue({
    items: [
      { id: 'rule-1', name: 'GitHub team membership' },
      { id: 'rule-2', name: 'Service ownership' },
    ],
    total: 2,
  });
});

describe('ObjectRelationshipsCard', () => {
  it('shows the Edit affordance for direct (ruleId-less) relationships in both directions', async () => {
    const onEditRelationship = vi.fn();
    renderCard({ onEditRelationship });

    // m-out (direct outgoing) and m-in (direct incoming) are editable;
    // the two rule-created edges are not, even the origin-'manual' one.
    const editButtons = await screen.findAllByRole('button', {
      name: 'Edit direct relationship',
    });
    expect(editButtons).toHaveLength(2);

    // Rows sort by type: memberOf, ownedBy (m-out), owns (m-in), partOf.
    await userEvent.click(editButtons[0]);
    expect(onEditRelationship).toHaveBeenCalledTimes(1);
    expect(onEditRelationship).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-out' }),
    );
    await userEvent.click(editButtons[1]);
    expect(onEditRelationship).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-in' }),
    );
  });

  it('renders no Edit affordance when onEditRelationship is omitted', () => {
    renderCard();
    expect(
      screen.queryByRole('button', { name: 'Edit direct relationship' }),
    ).not.toBeInTheDocument();
  });

  it('shows no provenance text on rows — it lives in the details popover', () => {
    renderCard();
    expect(screen.queryByText('Direct relationship')).not.toBeInTheDocument();
    expect(screen.queryByText('Relationship rule')).not.toBeInTheDocument();
  });

  it('shows the resolved rule name in the details popover of a rule edge', async () => {
    renderCard();
    const infoButtons = screen.getAllByRole('button', {
      name: 'Relationship details',
    });
    // Rows sort by relationship type: memberOf (r-out, rule-1), ownedBy
    // (m-out), owns (m-in), partOf (r-manual-origin).
    await userEvent.click(infoButtons[0]);
    expect(
      await screen.findByText('Rule: GitHub team membership'),
    ).toBeInTheDocument();
  });

  it('describes a direct edge as a direct relationship in the popover', async () => {
    renderCard();
    const infoButtons = screen.getAllByRole('button', {
      name: 'Relationship details',
    });
    await userEvent.click(infoButtons[1]);
    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveTextContent('Direct relationship');
  });

  it('renders a section per kind holding a box per related datasource', () => {
    renderCard();
    // One section per kind (memberOf, ownedBy, owns, partOf), each holding a
    // box named after the related datasource — every fixture edge points at
    // ds-2 ("Target").
    for (const label of ['Member of', 'Owned by', 'Owns', 'Part of']) {
      const section = screen.getByRole('region', { name: label });
      const box = within(section).getByRole('group', {
        name: `${label} · Target`,
      });
      expect(within(box).getByText('Target')).toBeInTheDocument();
      expect(within(box).getByText('1')).toBeInTheDocument();
    }
    // No card-level "Relationships" heading — the kind sections carry it.
    expect(screen.queryByText('Relationships')).not.toBeInTheDocument();
  });

  it('folds an incoming edge with a reciprocal type into the outgoing kind', async () => {
    // A owns B, created on A's side — from B's page this IS an "ownedBy"
    // relationship, so it must share a box with the outgoing ownedBy edge.
    const withReciprocal = [
      relationships[0], // m-out: outgoing ownedBy
      {
        ...relationships[3], // m-in: incoming owns
        reciprocalRelationshipType: 'ownedBy',
      },
    ] as ObjectRelationship[];
    renderCard({ relationships: withReciprocal });

    const box = screen.getByRole('group', { name: 'Owned by · Target' });
    expect(
      screen.queryByRole('region', { name: 'Owns' }),
    ).not.toBeInTheDocument();
    // Both edges sit in the single box, which counts 2.
    expect(within(box).getByText('2')).toBeInTheDocument();
    expect(within(box).getByText('Team A')).toBeInTheDocument();
    // The incoming edge has no name fields of its own — it resolves by
    // fetching the source object.
    expect(await within(box).findByText('Fetched')).toBeInTheDocument();
    // Fully labeled from this side, so no direction cue is needed.
    expect(screen.queryByText('incoming')).not.toBeInTheDocument();
  });

  it('marks an incoming edge without a reciprocal type as incoming', () => {
    renderCard();
    // m-in ("owns", created from the other side, no reciprocal) keeps its
    // forward type but carries the cue; the three outgoing edges do not.
    expect(screen.getAllByText('incoming')).toHaveLength(1);
    expect(
      within(screen.getByRole('group', { name: 'Owns · Target' })).getByText(
        'incoming',
      ),
    ).toBeInTheDocument();
  });

  it('paginates a long box five rows at a time', async () => {
    const user = userEvent.setup();
    const longRelationships = Array.from({ length: 7 }, (_, index) => ({
      id: `rel-${index + 1}`,
      origin: 'rule',
      ruleId: 'rule-1',
      direction: 'outgoing',
      relationshipType: 'dependsOn',
      sourceDatasourceId: 'ds-1',
      sourceObjectId: 'o1',
      destinationDatasourceId: 'ds-2',
      destinationObjectId: `target-${index + 1}`,
      metadata: { name: `Target ${index + 1}` },
      createdAt: '',
      updatedAt: '',
      updatedBy: null,
    })) as unknown as ObjectRelationship[];

    renderCard({ relationships: longRelationships });

    const box = screen.getByRole('group', { name: 'Depends on · Target' });
    expect(within(box).getByText('Target 5')).toBeInTheDocument();
    expect(within(box).queryByText('Target 6')).not.toBeInTheDocument();
    expect(within(box).getByText('1–5 of 7')).toBeInTheDocument();
    expect(
      within(box).getByRole('button', { name: 'Previous page' }),
    ).toBeDisabled();

    await user.click(within(box).getByRole('button', { name: 'Next page' }));
    expect(within(box).getByText('Target 7')).toBeInTheDocument();
    expect(within(box).queryByText('Target 1')).not.toBeInTheDocument();
    expect(within(box).getByText('6–7 of 7')).toBeInTheDocument();
    expect(
      within(box).getByRole('button', { name: 'Next page' }),
    ).toBeDisabled();

    await user.click(
      within(box).getByRole('button', { name: 'Previous page' }),
    );
    expect(within(box).getByText('Target 1')).toBeInTheDocument();
    expect(within(box).queryByText('Target 6')).not.toBeInTheDocument();
  });

  it('renders no pagination footer for a box within the page size', () => {
    renderCard();
    expect(
      screen.queryByRole('button', { name: 'Next page' }),
    ).not.toBeInTheDocument();
  });
});
