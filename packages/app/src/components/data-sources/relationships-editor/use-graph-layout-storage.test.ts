import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  parseStoredLayout,
  useGraphLayoutStorage,
} from './use-graph-layout-storage';
import {
  resetWorkspaceScope,
  setWorkspaceScope,
} from '../../../api/workspace-scope';

const KEY = 'graph-layout-datasources';

const validLayout = {
  nodes: [
    {
      id: 'workflow-ds-1',
      datasourceId: 'ds-1',
      position: { x: 10, y: 20 },
      width: 320,
    },
  ],
  edges: [
    {
      id: 'rule-r1',
      ruleId: 'r1',
      source: 'workflow-ds-1',
      target: 'workflow-ds-2',
    },
  ],
  viewport: { x: 1, y: 2, zoom: 0.8 },
};

describe('parseStoredLayout', () => {
  it('accepts a layout written by saveLayout', () => {
    expect(parseStoredLayout(JSON.stringify(validLayout))).toEqual(validLayout);
  });

  it('treats absent storage as no saved layout', () => {
    expect(parseStoredLayout(null)).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseStoredLayout('{ not json')).toBeNull();
  });

  it('rejects a layout missing its nodes array', () => {
    expect(
      parseStoredLayout(JSON.stringify({ ...validLayout, nodes: undefined })),
    ).toBeNull();
  });

  it('rejects a node whose position is not numeric', () => {
    expect(
      parseStoredLayout(
        JSON.stringify({
          ...validLayout,
          nodes: [{ ...validLayout.nodes[0], position: { x: 'left', y: 0 } }],
        }),
      ),
    ).toBeNull();
  });

  it('rejects a non-finite zoom', () => {
    expect(
      parseStoredLayout(
        JSON.stringify({
          ...validLayout,
          viewport: { x: 0, y: 0, zoom: Number.POSITIVE_INFINITY },
        }),
      ),
    ).toBeNull();
  });
});

describe('useGraphLayoutStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceScope();
  });

  it('exposes a stored layout on the very first render', () => {
    localStorage.setItem(KEY, JSON.stringify(validLayout));

    const { result } = renderHook(() => useGraphLayoutStorage('datasources'));

    expect(result.current.savedLayout).toEqual(validLayout);
  });

  it('falls back to no layout and discards a corrupt entry', () => {
    localStorage.setItem(KEY, JSON.stringify({ nodes: 'not-an-array' }));

    const { result } = renderHook(() => useGraphLayoutStorage('datasources'));

    expect(result.current.savedLayout).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('leaves a valid entry in place', () => {
    localStorage.setItem(KEY, JSON.stringify(validLayout));

    renderHook(() => useGraphLayoutStorage('datasources'));

    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('loads layouts only from the active workspace', () => {
    localStorage.setItem(
      'graph-layout-workspace-a:datasources',
      JSON.stringify(validLayout),
    );

    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    const workspaceB = renderHook(() => useGraphLayoutStorage('datasources'));
    expect(workspaceB.result.current.savedLayout).toBeNull();
    workspaceB.unmount();

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceA = renderHook(() => useGraphLayoutStorage('datasources'));
    expect(workspaceA.result.current.savedLayout).toEqual(validLayout);
  });
});
