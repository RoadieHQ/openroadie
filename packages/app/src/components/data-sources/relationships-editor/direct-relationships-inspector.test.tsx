import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../../test-utils';
import type { Relationship } from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import {
  DirectRelationshipList,
  DirectRelationshipsInspector,
} from './direct-relationships-inspector';

const mockGetObject = vi.fn();
vi.mock('../../../api', () => ({
  useDatastore: () => ({ getObject: mockGetObject }),
}));

const relationships = [
  {
    id: 'rel-1',
    sourceDatasourceId: 'ds-1',
    sourceObjectId: 'obj-a',
    destinationDatasourceId: 'ds-2',
    destinationObjectId: 'obj-b',
    relationshipType: 'ownedBy',
    origin: 'manual',
    ruleId: null,
    createdAt: '',
    updatedAt: '',
    updatedBy: null,
  },
] as unknown as Relationship[];

function makeRelationship(index: number): Relationship {
  return {
    id: `rel-${index}`,
    sourceDatasourceId: 'ds-1',
    sourceObjectId: `src-${index}`,
    destinationDatasourceId: 'ds-2',
    destinationObjectId: `dst-${index}`,
    relationshipType: 'ownedBy',
    origin: 'manual',
    ruleId: null,
    createdAt: '',
    updatedAt: '',
    updatedBy: null,
  } as unknown as Relationship;
}

function renderInspector(
  onClose = vi.fn(),
  onEditRelationship?: (rel: Relationship) => void,
) {
  render(
    <TestQueryProvider>
      <MemoryRouter>
        <DirectRelationshipsInspector
          open
          sourceDataSource={{ id: 'ds-1', name: 'Shortcut' } as DataSourceItem}
          targetDataSource={{ id: 'ds-2', name: 'GitHub' } as DataSourceItem}
          sourceDatasourceId="ds-1"
          targetDatasourceId="ds-2"
          relationships={relationships}
          onEditRelationship={onEditRelationship}
          onClose={onClose}
        />
      </MemoryRouter>
    </TestQueryProvider>,
  );
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetObject.mockImplementation(async (_ds: string, objId: string) => ({
    object: { name: objId === 'obj-a' ? 'Alice' : 'Bob' },
  }));
});

describe('DirectRelationshipsInspector', () => {
  it('lists the pair edges with resolved names and type', async () => {
    renderInspector();

    expect(await screen.findByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      '/datastore/ds-1/obj-a',
    );
    expect(screen.getByRole('link', { name: 'Bob' })).toHaveAttribute(
      'href',
      '/datastore/ds-2/obj-b',
    );
    expect(screen.getByText('Owned by')).toBeInTheDocument();
  });

  it('links each edge to its edit page under the source object', () => {
    renderInspector();

    expect(
      screen.getByRole('link', { name: 'Edit direct relationship' }),
    ).toHaveAttribute('href', '/datastore/ds-1/obj-a/relationships/rel-1/edit');
  });

  it('opens the in-place editor when onEditRelationship is provided', async () => {
    const onEdit = vi.fn();
    renderInspector(vi.fn(), onEdit);

    const pencil = screen.getByRole('button', {
      name: 'Edit direct relationship',
    });
    await userEvent.click(pencil);

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rel-1' }),
    );
    // No route link when editing in place.
    expect(
      screen.queryByRole('link', { name: 'Edit direct relationship' }),
    ).not.toBeInTheDocument();
  });

  it('closes on the close button', async () => {
    const onClose = renderInspector();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DirectRelationshipList', () => {
  it('paginates long relationship lists', async () => {
    const user = userEvent.setup();
    mockGetObject.mockImplementation(async (_ds: string, objId: string) => ({
      object: { name: objId },
    }));

    render(
      <TestQueryProvider>
        <MemoryRouter>
          <DirectRelationshipList
            relationships={Array.from({ length: 6 }, (_, index) =>
              makeRelationship(index + 1),
            )}
          />
        </MemoryRouter>
      </TestQueryProvider>,
    );

    expect(
      await screen.findByRole('link', { name: 'src-1' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'src-6' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(
      await screen.findByRole('link', { name: 'src-6' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
  });
});
