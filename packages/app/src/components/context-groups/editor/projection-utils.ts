import { applyProjection } from '@roadiehq/catalog-datastore-common';
import type {
  Annotation,
  ProjectionValue,
} from '../../../api/datastore/datastore-client';

export type ProjectionMode = 'include' | 'exclude';

export function leafSegment(path: string): string {
  const segments = path.split('.');
  return segments[segments.length - 1];
}

/** Output key for an included field: the leaf segment, disambiguated to the last
 *  two segments when another selected path shares the same leaf. */
export function autoLabel(path: string, selectedPaths: string[]): string {
  const leaf = leafSegment(path);
  const collisions = selectedPaths.filter(p => leafSegment(p) === leaf);
  if (collisions.length <= 1) return leaf;
  return path.split('.').slice(-2).join('.');
}

export interface ProjectionView {
  mode: ProjectionMode;
  /** No projection — the full object is returned. */
  isFull: boolean;
  /** Paths currently kept (checkbox = "in the bundle"). */
  kept: Set<string>;
  /** Exclude-mode dropped paths. */
  excluded: Set<string>;
  /** Include-mode label overrides, keyed by source path. */
  labels: Record<string, string>;
}

/** Interpret a persisted projection (union or legacy array) for rendering. */
export function deriveView(
  projection: ProjectionValue | undefined,
  allPaths: string[],
): ProjectionView {
  if (!projection) {
    return {
      mode: 'include',
      isFull: true,
      kept: new Set(allPaths),
      excluded: new Set(),
      labels: {},
    };
  }
  if (Array.isArray(projection)) {
    return {
      mode: 'include',
      isFull: false,
      kept: new Set(projection.map(f => f.source)),
      excluded: new Set(),
      labels: Object.fromEntries(projection.map(f => [f.source, f.label])),
    };
  }
  if (projection.mode === 'exclude') {
    const excluded = new Set(projection.paths);
    return {
      mode: 'exclude',
      isFull: false,
      kept: new Set(allPaths.filter(p => !excluded.has(p))),
      excluded,
      labels: {},
    };
  }
  return {
    mode: 'include',
    isFull: false,
    kept: new Set(projection.fields.map(f => f.source)),
    excluded: new Set(),
    labels: Object.fromEntries(projection.fields.map(f => [f.source, f.label])),
  };
}

/** An empty include selection means "full object" (no projection). */
export function includeProjection(
  paths: string[],
  labels: Record<string, string> = {},
): ProjectionValue | undefined {
  if (paths.length === 0) return undefined;
  return {
    mode: 'include',
    fields: paths.map(path => ({
      source: path,
      label: labels[`${path}`]?.trim() || autoLabel(path, paths),
    })),
  };
}

/** Excluding nothing means "full object" (no projection). */
export function excludeProjection(
  paths: string[],
): ProjectionValue | undefined {
  if (paths.length === 0) return undefined;
  return { mode: 'exclude', paths };
}

export interface PreviewColumn {
  id: string;
  name: string;
}

export interface PreviewMember {
  datasourceId: string;
  objectId: string;
  object: unknown;
}

export interface PreviewGroup {
  id: string;
  name: string;
  members: PreviewMember[];
}

/**
 * Build the JSON shown for a group in the editor preview, mirroring the real
 * bundle (`ContextGroupDao.getGroupWithMembers`): projected object data grouped
 * by datasource, with rule-level and per-datasource annotations, so the
 * on-screen JSON is exactly what an agent receives.
 */
export function buildBundlePreviewJson(params: {
  group: PreviewGroup;
  columns: PreviewColumn[];
  projectionByDatasourceId: Map<string, ProjectionValue>;
  annotationByDatasourceId: Map<string, Annotation>;
  annotations: Annotation[];
  ruleName: string;
}): Record<string, unknown> {
  const {
    group,
    columns,
    projectionByDatasourceId,
    annotationByDatasourceId,
    annotations,
    ruleName,
  } = params;

  const datasources = columns
    .map(col => {
      const members = group.members.filter(m => m.datasourceId === col.id);
      const annotation = annotationByDatasourceId.get(col.id);
      return {
        datasource: col.name,
        ...(annotation ? { annotation } : {}),
        objects: members.map(m => ({
          objectId: m.objectId,
          data: applyProjection(m.object, projectionByDatasourceId.get(col.id)),
        })),
      };
    })
    .filter(block => block.objects.length > 0);

  return {
    ruleName: ruleName || '(preview)',
    contextGroupName: group.name,
    ...(annotations.length > 0 ? { annotations } : {}),
    datasources,
  };
}

export type PresetKey = 'identifiers' | 'essentials' | 'full' | 'custom';

/** Which preset the current projection matches, for highlighting the control. */
export function activePreset(
  projection: ProjectionValue | undefined,
  presets: { identifiers: string[]; essentials: string[] },
): PresetKey {
  if (!projection) return 'full';
  const view = deriveView(projection, []);
  if (view.mode !== 'include') return 'custom';
  const kept = view.kept;
  const sameSet = (paths: string[]) =>
    paths.length === kept.size && paths.every(p => kept.has(p));
  if (sameSet(presets.identifiers)) return 'identifiers';
  if (sameSet(presets.essentials)) return 'essentials';
  return 'custom';
}
