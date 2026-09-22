// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { TestQueryProvider } from '../../../../test-utils';
import type { EgoGraphContainerProps } from './ego';
import { DatastoreGraphPage } from './datastore-graph-page';

const mockAlertApi = { post: vi.fn() };
const mockDatastoreApi = {
  searchObjects: vi.fn(),
  getObject: vi.fn(),
  listRelationshipRules: vi.fn(),
  findContextGroupsByMember: vi.fn(),
  queryRootedObjectGraph: vi.fn(),
  getContextGroupBundle: vi.fn(),
};

vi.mock('../../../../api', () => ({
  useAlert: () => mockAlertApi,
  useDatastore: () => mockDatastoreApi,
}));

const mockUseDataSources = vi.fn();
vi.mock('../../use-data-sources', () => ({
  useDataSources: (...args: unknown[]) => mockUseDataSources(...args),
}));

vi.mock('./use-relationship-types', () => ({
  useRelationshipTypes: () => ({
    types: ['owns', 'uses'],
    loading: false,
  }),
}));

let capturedObjectProps: EgoGraphContainerProps | undefined;
vi.mock('./ego', async () => {
  const actual = await vi.importActual<typeof import('./ego')>('./ego');
  return {
    ...actual,
    EgoGraphContainer: (props: EgoGraphContainerProps) => {
      capturedObjectProps = props;
      return (
        <div data-testid="object-mode">
          <Button
            type="button"
            onClick={() =>
              props.onFocusChange({ datasourceId: 'ds-1', objectId: 'x' })
            }
          >
            pick focus
          </Button>
          <Button
            type="button"
            onClick={() =>
              props.onFocusIntent?.({
                datasourceId: 'ds-1',
                objectId: 'repo-1',
              })
            }
          >
            show focus intent
          </Button>
          <Button type="button" onClick={() => props.onDepthChange(3)}>
            set depth
          </Button>
          <Button
            type="button"
            onClick={() =>
              props.onNodeSelect?.({ datasourceId: 'ds-1', objectId: 'y' })
            }
          >
            select node
          </Button>
          <Button
            type="button"
            onClick={() =>
              props.onEdgeSelect?.({
                id: 'rel-1',
                relationshipType: 'owns',
                ruleId: null,
                source: {
                  datasourceId: 'ds-1',
                  objectId: 'x',
                  label: 'Repo X',
                },
                target: {
                  datasourceId: 'ds-2',
                  objectId: 'z',
                  label: 'Issue Z',
                },
              })
            }
          >
            select edge
          </Button>
          <Button
            type="button"
            onClick={() =>
              props.onShowPaths?.(
                { datasourceId: 'ds-1', objectId: 'x' },
                { datasourceId: 'ds-2', objectId: 'z' },
              )
            }
          >
            show paths
          </Button>
          <Button type="button" onClick={() => props.onGroupSelect?.('grp-1')}>
            select group
          </Button>
          <Button
            type="button"
            onClick={() =>
              props.onEdgeSelect?.({
                id: 'cg-edge-1',
                relationshipType: 'owns',
                ruleId: null,
                source: {
                  kind: 'group',
                  groupId: 'grp-1',
                  label: 'Team Alpha',
                  ruleName: 'Teams',
                },
                target: {
                  datasourceId: 'ds-2',
                  objectId: 'z',
                  label: 'Issue Z',
                },
                members: [
                  {
                    id: 'rel-1',
                    relationshipType: 'owns',
                    ruleId: null,
                    source: {
                      datasourceId: 'ds-1',
                      objectId: 'm1',
                      label: 'Member One',
                    },
                    target: {
                      datasourceId: 'ds-2',
                      objectId: 'z',
                      label: 'Issue Z',
                    },
                  },
                  {
                    id: 'rel-2',
                    relationshipType: 'owns',
                    ruleId: 'rule-9',
                    source: {
                      datasourceId: 'ds-1',
                      objectId: 'm2',
                      label: 'Member Two',
                    },
                    target: {
                      datasourceId: 'ds-2',
                      objectId: 'z',
                      label: 'Issue Z',
                    },
                  },
                ],
              })
            }
          >
            select aggregated edge
          </Button>
        </div>
      );
    },
  };
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderPage(initialEntry = '/datastore/graph') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DatastoreGraphPage />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper: TestQueryProvider },
  );
}

function locationSearch(): string {
  return screen.getByTestId('location-search').textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  capturedObjectProps = undefined;
  mockUseDataSources.mockReturnValue({
    dataSources: [
      {
        id: 'ds-1',
        name: 'GitHub Repositories',
        enabled: true,
        objectCount: 1,
        integration: { label: 'GitHub', type: 'scm' },
      },
      {
        id: 'ds-2',
        name: 'Jira Issues',
        enabled: true,
        objectCount: 1,
        integration: { label: 'Jira', type: 'pm' },
      },
    ],
    loading: false,
    error: undefined,
  });
  mockDatastoreApi.searchObjects.mockResolvedValue({ items: [], total: 0 });
  mockDatastoreApi.getObject.mockResolvedValue({
    object: { name: 'Repo Y' },
    relationships: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  mockDatastoreApi.listRelationshipRules.mockResolvedValue({
    items: [],
    total: 0,
  });
  mockDatastoreApi.findContextGroupsByMember.mockResolvedValue([]);
  mockDatastoreApi.queryRootedObjectGraph.mockResolvedValue({
    nodes: [],
    relationships: [],
    truncated: false,
  });
  mockDatastoreApi.getContextGroupBundle.mockResolvedValue({
    id: 'grp-1',
    ruleId: 'rule-1',
    ruleName: 'Teams',
    ruleDescription: null,
    title: 'Team Alpha',
    totalMembers: 2,
    totalInternalRelationships: 1,
    totalExternalRelationships: 1,
    members: [
      {
        datasourceId: 'ds-1',
        objectId: 'm1',
        object: {},
        presentation: { title: 'Member One' },
      },
    ],
    internalRelationships: [],
    externalRelationships: [],
    annotations: [],
    datasources: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('DatastoreGraphPage', () => {
  it('guides first-time users to create a data source instead of rendering empty graph controls', async () => {
    const user = userEvent.setup();
    mockUseDataSources.mockReturnValue({
      dataSources: [],
      loading: false,
      error: undefined,
    });

    renderPage();

    expect(
      screen.getByRole('heading', { name: 'No objects to explore yet' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New Data Source' }));
    expect(locationSearch()).toBe('?new=1');
    expect(screen.queryByRole('radio', { name: 'Object' })).toBeNull();
    expect(screen.queryByTestId('object-mode')).toBeNull();
  });

  it('defaults to the object mode', () => {
    renderPage();
    expect(screen.getByRole('radio', { name: 'Object' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('object-mode')).toBeInTheDocument();
  });

  it('switches modes via the toggle, writing ?view=', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('radio', { name: 'Paths' }));
    expect(locationSearch()).toContain('view=paths');
    expect(screen.queryByTestId('object-mode')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Object' }));
    expect(locationSearch()).not.toContain('view=');
    expect(screen.getByTestId('object-mode')).toBeInTheDocument();
  });

  it('clears another mode’s params when switching away, keeping shared ones', async () => {
    const user = userEvent.setup();
    renderPage(
      '/datastore/graph?view=object&focus=ds-1:x&depth=3&dir=out' +
        '&ds=ds-1&types=owns',
    );

    await user.click(screen.getByRole('radio', { name: 'Paths' }));

    const search = locationSearch();
    expect(search).toContain('view=paths');
    expect(search).not.toContain('focus=');
    expect(search).not.toContain('depth=');
    expect(search).not.toContain('dir=');
    expect(search).toContain('ds=ds-1');
    expect(search).toContain('types=owns');
  });

  it('renders the object mode for a legacy bare ?focus= deep link', () => {
    renderPage('/datastore/graph?focus=ds-1:obj-9');
    expect(screen.getByTestId('object-mode')).toBeInTheDocument();
    expect(capturedObjectProps?.focus).toEqual({
      datasourceId: 'ds-1',
      objectId: 'obj-9',
    });
  });

  it('passes the shared filters into the object mode', () => {
    renderPage(
      '/datastore/graph?view=object&focus=ds-1:x' +
        '&ds=ds-1,ds-2&types=owns&dir=in&depth=3',
    );
    expect(capturedObjectProps?.depth).toBe(3);
    expect(capturedObjectProps?.filters).toEqual({
      datasourceIds: ['ds-1', 'ds-2'],
      relationshipTypes: ['owns'],
      direction: 'in',
    });
  });

  it('prefetches a bounded graph when an object search result shows intent', async () => {
    mockDatastoreApi.searchObjects.mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'stored-1',
          datasourceId: 'ds-1',
          objectId: 'repo-1',
          object: { name: 'Roadie' },
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    });
    const user = userEvent.setup();
    renderPage('/datastore/graph?ds=ds-1&types=owns&dir=out&depth=2');

    await user.type(
      screen.getByRole('textbox', { name: 'Search objects' }),
      'Roadie',
    );
    await user.hover(
      await screen.findByRole('button', {
        name: /Roadie.*GitHub Repositories/,
      }),
    );

    await waitFor(() =>
      expect(mockDatastoreApi.queryRootedObjectGraph).toHaveBeenCalledWith(
        {
          rootDatasourceId: 'ds-1',
          rootObjectId: 'repo-1',
          depth: 2,
          nodeLimit: 150,
          datasourceIds: ['ds-1'],
          relationshipTypes: ['owns'],
          origin: undefined,
          direction: 'out',
        },
        expect.any(AbortSignal),
      ),
    );
  });

  it('prefetches from the object mode empty-state picker', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?ds=ds-1&types=owns&dir=out&depth=2');

    await user.click(screen.getByRole('button', { name: 'show focus intent' }));

    await waitFor(() =>
      expect(mockDatastoreApi.queryRootedObjectGraph).toHaveBeenCalledWith(
        {
          rootDatasourceId: 'ds-1',
          rootObjectId: 'repo-1',
          depth: 2,
          nodeLimit: 150,
          datasourceIds: ['ds-1'],
          relationshipTypes: ['owns'],
          origin: undefined,
          direction: 'out',
        },
        expect.any(AbortSignal),
      ),
    );
  });

  it('writes focus changes from the object mode with a push', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object');

    await user.click(screen.getByRole('button', { name: 'pick focus' }));
    expect(locationSearch()).toContain('focus=ds-1%3Ax');

    await user.click(screen.getByRole('button', { name: 'set depth' }));
    expect(locationSearch()).toContain('depth=3');
  });

  it('writes edge-filter changes to the URL', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Graph filters' }));
    await user.click(screen.getByRole('button', { name: 'All types' }));
    await user.click(screen.getByRole('option', { name: 'Owns' }));
    expect(
      screen.getByText(
        'Narrow relationships without changing the selected source.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Uses' }));

    await user.click(
      screen.getByRole('combobox', { name: 'Traversal direction' }),
    );
    await user.click(screen.getByRole('option', { name: 'Incoming only' }));

    expect(locationSearch()).toContain('dir=in');
    expect(locationSearch()).toContain('types=owns%2Cuses');
    expect(
      screen.getByText(
        'Narrow relationships without changing the selected source.',
      ),
    ).toBeInTheDocument();
  });

  it('offers no relationship-origin filter', () => {
    renderPage();
    expect(
      screen.queryByRole('combobox', {
        name: 'Filter by relationship origin',
      }),
    ).not.toBeInTheDocument();
  });

  it('restores the last mode from sessionStorage on a bare visit', async () => {
    window.sessionStorage.setItem('roadie.datastore.graph.view', 'paths');
    renderPage();
    await waitFor(() => {
      expect(locationSearch()).toContain('view=paths');
    });
  });

  it('restores only the graph data-source scope', async () => {
    window.sessionStorage.setItem('roadie.datastore.table.scope', 'ds-1');
    window.sessionStorage.setItem('roadie.datastore.graph.scope', 'ds-2');

    renderPage();

    await waitFor(() => {
      expect(locationSearch()).toContain('ds=ds-2');
    });
    expect(locationSearch()).not.toContain('ds=ds-1');
  });

  it('applies a saved view as one navigation and restores its extras', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'roadie.datastore.graph.saved-views.v1',
      JSON.stringify({
        version: 1,
        views: [
          {
            id: 'view-1',
            name: 'Saved exploration',
            createdAt: '2026-07-28T00:00:00.000Z',
            params: { view: 'object', focus: 'ds-1:x', depth: '3' },
            objectState: {
              expandedKeys: ['ds-1:y'],
              revealCounts: { group: 10 },
            },
            camera: { x: 5, y: 6, k: 2 },
          },
        ],
      }),
    );
    renderPage();

    await user.click(screen.getByTestId('saved-views-trigger'));
    await user.click(
      screen.getByRole('menuitem', { name: /Saved exploration/ }),
    );

    await waitFor(() => {
      expect(locationSearch()).toContain('view=object');
    });
    expect(locationSearch()).toContain('focus=ds-1%3Ax');
    expect(locationSearch()).toContain('depth=3');
    expect(capturedObjectProps?.restore).toEqual(
      expect.objectContaining({
        nonce: 1,
        expandedKeys: ['ds-1:y'],
        revealCounts: { group: 10 },
        camera: { x: 5, y: 6, k: 2 },
      }),
    );
    window.localStorage.clear();
  });

  it('opens the object summary drawer via ?object= when a node is selected', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object&focus=ds-1:x');

    await user.click(screen.getByRole('button', { name: 'select node' }));

    expect(locationSearch()).toContain('object=ds-1%2Fy');
    expect(
      await screen.findByRole('heading', { name: 'Repo Y' }),
    ).toBeInTheDocument();
    // The selected node's key flows back down for the highlight ring.
    expect(capturedObjectProps?.selectedNodeKey).toBe('ds-1:y');
  });

  it('opens the relationship drawer when an edge is selected, highlighting it', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object&focus=ds-1:x');

    await user.click(screen.getByRole('button', { name: 'select edge' }));

    expect(await screen.findByText('Repo X')).toBeInTheDocument();
    expect(screen.getByText('Issue Z')).toBeInTheDocument();
    expect(capturedObjectProps?.selectedEdgeId).toBe('rel-1');
  });

  it('swaps the relationship drawer for the object drawer on an endpoint click', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object&focus=ds-1:x');

    await user.click(screen.getByRole('button', { name: 'select edge' }));
    await user.click(await screen.findByRole('button', { name: /Issue Z/ }));

    expect(locationSearch()).toContain('object=ds-2%2Fz');
    expect(capturedObjectProps?.selectedEdgeId).toBeNull();
  });

  it('jumps to the paths view when two nodes are picked in the object mode', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object&focus=ds-1:x&depth=3');

    await user.click(screen.getByRole('button', { name: 'show paths' }));

    const search = locationSearch();
    expect(search).toContain('view=paths');
    expect(search).toContain('a=ds-1%3Ax');
    expect(search).toContain('b=ds-2%3Az');
    expect(search).not.toContain('focus=');
    expect(search).not.toContain('depth=');
  });

  it('collapses context groups by default and writes ?groups= when expanded', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object&focus=ds-1:x');

    await user.click(screen.getByRole('button', { name: 'Graph filters' }));
    const checkbox = screen.getByRole('checkbox', {
      name: 'Expand context groups',
    });
    expect(checkbox).not.toBeChecked();
    expect(capturedObjectProps?.expandGroups).toBe(false);

    await user.click(checkbox);
    expect(locationSearch()).toContain('groups=expanded');
    expect(capturedObjectProps?.expandGroups).toBe(true);

    await user.click(checkbox);
    expect(locationSearch()).not.toContain('groups=');
    expect(capturedObjectProps?.expandGroups).toBe(false);
  });

  it('leaves the expand-groups choice alone when edge filters are cleared', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?groups=expanded&types=owns');

    await user.click(
      screen.getByRole('button', { name: 'Graph filters, 1 active' }),
    );
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    const search = locationSearch();
    expect(search).not.toContain('types=');
    expect(search).toContain('groups=expanded');
  });

  it('restores the expand-groups choice from sessionStorage on a bare visit', async () => {
    window.sessionStorage.setItem('roadie.datastore.graph.groups', 'expanded');
    renderPage();
    await waitFor(() => {
      expect(locationSearch()).toContain('groups=expanded');
    });
  });

  it('opens the context-group drawer when a group node is selected', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object&focus=ds-1:x');

    await user.click(screen.getByRole('button', { name: 'select group' }));

    expect(
      await screen.findByRole('heading', { name: 'Team Alpha' }),
    ).toBeInTheDocument();
    expect(mockDatastoreApi.getContextGroupBundle).toHaveBeenCalledWith(
      'grp-1',
      expect.anything(),
    );
    // The group's node key flows back down for the highlight ring.
    expect(capturedObjectProps?.selectedGroupId).toBe('grp-1');
  });

  it('lists the folded member relationships for an aggregated edge', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object&focus=ds-1:x');

    await user.click(
      screen.getByRole('button', { name: 'select aggregated edge' }),
    );

    expect(await screen.findByText('Team Alpha')).toBeInTheDocument();
    expect(
      screen.getByText('Aggregated from 2 relationships'),
    ).toBeInTheDocument();
    expect(screen.getByText('Member One')).toBeInTheDocument();
    expect(screen.getByText('Member Two')).toBeInTheDocument();

    // A member endpoint click swaps to that object's drawer.
    await user.click(screen.getByRole('button', { name: /Member One/ }));
    expect(locationSearch()).toContain('object=ds-1%2Fm1');
  });

  it('swaps the relationship drawer for the group drawer on a group endpoint click', async () => {
    const user = userEvent.setup();
    renderPage('/datastore/graph?view=object&focus=ds-1:x');

    await user.click(
      screen.getByRole('button', { name: 'select aggregated edge' }),
    );
    await user.click(await screen.findByRole('button', { name: /Team Alpha/ }));

    expect(
      await screen.findByRole('heading', { name: 'Team Alpha' }),
    ).toBeInTheDocument();
    expect(capturedObjectProps?.selectedGroupId).toBe('grp-1');
    expect(capturedObjectProps?.selectedEdgeId).toBeNull();
  });

  it('posts an alert when data sources fail to load', () => {
    mockUseDataSources.mockReturnValue({
      dataSources: [],
      loading: false,
      error: new Error('nope'),
    });
    renderPage();
    expect(mockAlertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
  });
});
