export const OBJECT_GRAPH_DEPTH_OPTIONS = [1, 2, 3] as const;
export type ObjectGraphDepth = (typeof OBJECT_GRAPH_DEPTH_OPTIONS)[number];

export const DEFAULT_OBJECT_GRAPH_DEPTH: ObjectGraphDepth = 2;
export const ROOTED_OBJECT_GRAPH_NODE_LIMIT = 150;

export interface ObjectGraphFocus {
  datasourceId: string;
  objectId: string;
}

export function objectGraphNodeId(
  datasourceId: string,
  objectId: string,
): string {
  return `${datasourceId}:${objectId}`;
}

export function isObjectGraphDepth(value: number): value is ObjectGraphDepth {
  return value === 1 || value === 2 || value === 3;
}
