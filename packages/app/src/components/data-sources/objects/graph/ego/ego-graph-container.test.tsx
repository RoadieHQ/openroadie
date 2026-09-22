// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { TestQueryProvider } from '../../../../../test-utils';
import type { EgoGraphViewProps } from './ego-graph-view';
import {
  EgoGraphContainer,
  type EgoGraphContainerProps,
} from './ego-graph-container';

// The focus controls resolve the focused object's display name.
vi.mock('../../../../../api', () => ({
  useDatastore: () => ({
    getObject: vi.fn().mockResolvedValue({
      object: { name: 'Repo X' },
      relationships: [],
    }),
  }),
}));

let capturedViewProps: EgoGraphViewProps | undefined;
vi.mock('./ego-graph-view', async () => {
  const actual =
    await vi.importActual<typeof import('./ego-graph-view')>(
      './ego-graph-view',
    );
  return {
    ...actual,
    EgoGraphView: (props: EgoGraphViewProps) => {
      capturedViewProps = props;
      return <div data-testid="ego-view" />;
    },
  };
});

const TEAMS_GROUP = {
  groupId: 'grp-1',
  ruleId: 'rule-1',
  ruleName: 'Teams',
  title: 'Team Alpha',
};

interface MockGraphNode {
  datasourceId: string;
  objectId: string;
  displayName: string;
  hiddenNeighborCount: number;
  contextGroups?: (typeof TEAMS_GROUP)[];
}

let mockGraphState = defaultGraphState();
function defaultGraphState() {
  return {
    nodes: [
      {
        datasourceId: 'ds-1',
        objectId: 'x',
        displayName: 'Repo X',
        hiddenNeighborCount: 0,
      },
      {
        datasourceId: 'ds-1',
        objectId: 'y',
        displayName: 'Repo Y',
        hiddenNeighborCount: 0,
      },
      {
        datasourceId: 'ds-2',
        objectId: 'z',
        displayName: 'Issue Z',
        hiddenNeighborCount: 0,
      },
    ] as MockGraphNode[],
    relationships: [] as unknown[],
    loading: false,
    refreshing: false,
    error: null,
    truncated: false,
    rootNodeId: 'ds-1:x',
  };
}

vi.mock('./use-rooted-object-graph', () => ({
  useRootedObjectGraph: () => mockGraphState,
}));

function renderContainer(
  onShowPaths = vi.fn(),
  options?: Partial<EgoGraphContainerProps>,
) {
  render(
    <MemoryRouter>
      <EgoGraphContainer
        focus={{ datasourceId: 'ds-1', objectId: 'x' }}
        depth={2}
        filters={{
          datasourceIds: [],
          relationshipTypes: [],
          direction: 'both',
        }}
        dataSources={[]}
        expandGroups
        onFocusChange={vi.fn()}
        onDepthChange={vi.fn()}
        onShowPaths={onShowPaths}
        {...options}
      />
    </MemoryRouter>,
    { wrapper: TestQueryProvider },
  );
  return onShowPaths;
}

function pathSelect(key: string) {
  act(() => {
    capturedViewProps?.onNodePathSelect?.(key);
  });
}

beforeEach(() => {
  capturedViewProps = undefined;
  mockGraphState = defaultGraphState();
});

afterEach(() => {
  cleanup();
});

describe('EgoGraphContainer shift-click paths picking', () => {
  it('rings the first pick and shows the anchor pill with its label', () => {
    renderContainer();
    pathSelect('ds-1:y');

    expect(screen.getByTestId('path-anchor-pill')).toHaveTextContent('Repo Y');
    expect(capturedViewProps?.pathAnchorKey).toBe('ds-1:y');
  });

  it('cancels the pick when the anchor is shift-clicked again', () => {
    renderContainer();
    pathSelect('ds-1:y');
    pathSelect('ds-1:y');

    expect(screen.queryByTestId('path-anchor-pill')).not.toBeInTheDocument();
    expect(capturedViewProps?.pathAnchorKey).toBeNull();
  });

  it('fires onShowPaths with both endpoints on the second pick and clears the anchor', () => {
    const onShowPaths = renderContainer();
    pathSelect('ds-1:y');
    pathSelect('ds-2:z');

    expect(onShowPaths).toHaveBeenCalledWith(
      { datasourceId: 'ds-1', objectId: 'y' },
      { datasourceId: 'ds-2', objectId: 'z' },
    );
    expect(screen.queryByTestId('path-anchor-pill')).not.toBeInTheDocument();
  });

  it('clears the anchor via the pill’s cancel button', async () => {
    const user = userEvent.setup();
    renderContainer();
    pathSelect('ds-1:y');

    await user.click(
      screen.getByRole('button', { name: 'Cancel the paths pick' }),
    );

    expect(screen.queryByTestId('path-anchor-pill')).not.toBeInTheDocument();
    expect(capturedViewProps?.pathAnchorKey).toBeNull();
  });
});

describe('EgoGraphContainer context-group collapse', () => {
  beforeEach(() => {
    mockGraphState = {
      ...defaultGraphState(),
      nodes: [
        {
          datasourceId: 'ds-1',
          objectId: 'x',
          displayName: 'Repo X',
          hiddenNeighborCount: 0,
          // The root's own membership must never fold it away.
          contextGroups: [TEAMS_GROUP],
        },
        {
          datasourceId: 'ds-1',
          objectId: 'y',
          displayName: 'Repo Y',
          hiddenNeighborCount: 2,
          contextGroups: [TEAMS_GROUP],
        },
        {
          datasourceId: 'ds-2',
          objectId: 'z',
          displayName: 'Issue Z',
          hiddenNeighborCount: 0,
        },
      ],
      relationships: [
        {
          id: 'e1',
          sourceDatasourceId: 'ds-1',
          sourceObjectId: 'x',
          destinationDatasourceId: 'ds-1',
          destinationObjectId: 'y',
          relationshipType: 'owns',
          ruleId: null,
          origin: 'manual',
        },
        {
          id: 'e2',
          sourceDatasourceId: 'ds-1',
          sourceObjectId: 'y',
          destinationDatasourceId: 'ds-2',
          destinationObjectId: 'z',
          relationshipType: 'uses',
          ruleId: null,
          origin: 'manual',
        },
      ],
    };
  });

  it('folds grouped neighbors into a group node with aggregated edges', () => {
    renderContainer(vi.fn(), { expandGroups: false });

    const keys = capturedViewProps?.nodes.map(node => node.key) ?? [];
    expect(keys).toContain('ds-1:x');
    expect(keys).toContain('ds-2:z');
    expect(keys).toContain('group:grp-1');
    expect(keys).not.toContain('ds-1:y');
    const groupNode = capturedViewProps?.nodes.find(
      node => node.key === 'group:grp-1',
    );
    expect(groupNode?.group).toEqual(
      expect.objectContaining({ title: 'Team Alpha', memberCount: 1 }),
    );
    // Both of the member's edges now step from the group node.
    const edges = capturedViewProps?.edges ?? [];
    expect(edges).toHaveLength(2);
    expect(
      edges.every(
        edge =>
          edge.sourceKey === 'group:grp-1' || edge.targetKey === 'group:grp-1',
      ),
    ).toBe(true);
    expect(edges.every(edge => edge.underlying?.length === 1)).toBe(true);
  });

  it('leaves everything expanded when expandGroups is on', () => {
    renderContainer(vi.fn(), { expandGroups: true });

    const keys = capturedViewProps?.nodes.map(node => node.key) ?? [];
    expect(keys).toEqual(['ds-1:x', 'ds-1:y', 'ds-2:z']);
    expect(capturedViewProps?.edges.map(edge => edge.id)).toEqual(['e1', 'e2']);
  });

  it('moves a folded object’s selection ring onto its group node', () => {
    renderContainer(vi.fn(), {
      expandGroups: false,
      selectedNodeKey: 'ds-1:y',
    });
    expect(capturedViewProps?.selectedNodeKeys).toEqual(['group:grp-1']);
  });

  it('rings the open group drawer’s node', () => {
    renderContainer(vi.fn(), {
      expandGroups: false,
      selectedGroupId: 'grp-1',
    });
    expect(capturedViewProps?.selectedNodeKeys).toEqual(['group:grp-1']);
  });
});
