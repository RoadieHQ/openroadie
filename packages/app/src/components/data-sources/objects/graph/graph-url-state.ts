import {
  OBJECT_GRAPH_PATHS_MAX_DEPTH,
  type GraphTraversalDirection,
} from '../../../../api/datastore/datastore-client';
import { parseCsvParam } from '../../../common';
import { isContextGroupScopeId } from '../context-group-scope';
import {
  DEFAULT_OBJECT_GRAPH_DEPTH,
  isObjectGraphDepth,
  objectGraphNodeId,
  type ObjectGraphDepth,
  type ObjectGraphFocus,
} from './object-graph-focus';

export type GraphViewMode = 'object' | 'paths';

/**
 * The graph page's full URL param model. `view` selects the mode; `ds`,
 * `types` and `groups` apply to every mode; the rest are per-mode:
 * object owns `focus`/`depth`/`dir`, paths owns `a`/`b`/`pathDepth`.
 */
export interface GraphUrlState {
  view: GraphViewMode;
  ds: string[];
  types: string[];
  /** True = grouped objects render individually; false (the default) folds
   * them into their materialized context-group nodes. */
  expandGroups: boolean;
  focus: ObjectGraphFocus | null;
  depth: ObjectGraphDepth;
  dir: GraphTraversalDirection;
  a: ObjectGraphFocus | null;
  b: ObjectGraphFocus | null;
  /** Explicit "≤ N hops" pick; null (the default) = shortest paths only. */
  pathDepth: number | null;
}

/** `?groups=expanded` — the only non-default value; absent = collapsed. */
export const EXPAND_GROUPS_PARAM_VALUE = 'expanded';

export function parseObjectGraphFocus(
  rawFocus: string | null,
): ObjectGraphFocus | null {
  if (!rawFocus) {
    return null;
  }
  const separatorIndex = rawFocus.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === rawFocus.length - 1) {
    return null;
  }
  return {
    datasourceId: rawFocus.slice(0, separatorIndex),
    objectId: rawFocus.slice(separatorIndex + 1),
  };
}

function parseDepth(value: string | null): ObjectGraphDepth {
  if (!value) {
    return DEFAULT_OBJECT_GRAPH_DEPTH;
  }
  const parsed = Number(value);
  return isObjectGraphDepth(parsed) ? parsed : DEFAULT_OBJECT_GRAPH_DEPTH;
}

function parsePathDepth(value: string | null): number | null {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed)) {
    return null;
  }
  return Math.min(OBJECT_GRAPH_PATHS_MAX_DEPTH, Math.max(1, parsed));
}

function parseDirection(value: string | null): GraphTraversalDirection {
  return value === 'out' || value === 'in' ? value : 'both';
}

function parseView(value: string | null): GraphViewMode {
  // Unknown values (including the retired `overview`) fall back to the
  // object view.
  return value === 'paths' ? 'paths' : 'object';
}

export function parseGraphUrlState(params: URLSearchParams): GraphUrlState {
  const focus = parseObjectGraphFocus(params.get('focus'));
  return {
    view: parseView(params.get('view')),
    // The table view shares `?ds=` and may scope to context-group rules
    // (`cg:<ruleId>`); the graph has no group nodes, so those entries are
    // ignored here rather than sent to the graph endpoints.
    ds: parseCsvParam(params.get('ds')).filter(
      id => !isContextGroupScopeId(id),
    ),
    types: parseCsvParam(params.get('types')),
    expandGroups: params.get('groups') === EXPAND_GROUPS_PARAM_VALUE,
    focus,
    depth: parseDepth(params.get('depth')),
    dir: parseDirection(params.get('dir')),
    a: parseObjectGraphFocus(params.get('a')),
    b: parseObjectGraphFocus(params.get('b')),
    pathDepth: parsePathDepth(params.get('pathDepth')),
  };
}

/** Serializes the state back to params, omitting every default. */
export function graphUrlStateToParams(state: GraphUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view !== 'object') {
    params.set('view', state.view);
  }
  if (state.ds.length > 0) {
    params.set('ds', state.ds.join(','));
  }
  if (state.types.length > 0) {
    params.set('types', state.types.join(','));
  }
  if (state.expandGroups) {
    params.set('groups', EXPAND_GROUPS_PARAM_VALUE);
  }
  if (state.focus) {
    params.set(
      'focus',
      objectGraphNodeId(state.focus.datasourceId, state.focus.objectId),
    );
  }
  if (state.depth !== DEFAULT_OBJECT_GRAPH_DEPTH) {
    params.set('depth', String(state.depth));
  }
  if (state.dir !== 'both') {
    params.set('dir', state.dir);
  }
  if (state.a) {
    params.set('a', objectGraphNodeId(state.a.datasourceId, state.a.objectId));
  }
  if (state.b) {
    params.set('b', objectGraphNodeId(state.b.datasourceId, state.b.objectId));
  }
  if (state.pathDepth !== null) {
    params.set('pathDepth', String(state.pathDepth));
  }
  return params;
}

/** Params owned by one mode, cleared when switching away from it. */
export const MODE_PARAMS: Record<GraphViewMode, readonly string[]> = {
  object: ['focus', 'depth', 'dir'],
  paths: ['a', 'b', 'pathDepth'],
};
