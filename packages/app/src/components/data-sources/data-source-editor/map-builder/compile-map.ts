import type { MapOverride, MapOverrideSource, MapRules } from './types';

interface TreeNode {
  leaf: MapOverrideSource | null;
  /** Insertion-ordered children keyed by path segment. */
  children: Map<string, TreeNode>;
}

function makeNode(): TreeNode {
  return { leaf: null, children: new Map() };
}

function insert(root: TreeNode, override: MapOverride): void {
  const segments = override.targetPath.split('.').filter(Boolean);
  if (segments.length === 0) {
    return;
  }
  const intermediate = segments.slice(0, -1);
  const lastSeg = segments[segments.length - 1];
  let cursor = root;
  for (const seg of intermediate) {
    let child = cursor.children.get(seg);
    if (!child) {
      child = makeNode();
      cursor.children.set(seg, child);
    }
    cursor = child;
  }
  let leafNode = cursor.children.get(lastSeg);
  if (!leafNode) {
    leafNode = makeNode();
    cursor.children.set(lastSeg, leafNode);
  }
  leafNode.leaf = override.source;
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function compileSource(source: MapOverrideSource): string {
  switch (source.kind) {
    case 'literal':
      switch (source.valueType) {
        case 'string':
          return `"${escapeString(String(source.value ?? ''))}"`;
        case 'number':
          return String(source.value ?? 0);
        case 'boolean':
          return source.value ? 'true' : 'false';
        case 'null':
          return 'null';
        default:
          return 'null';
      }
    case 'field':
      return source.path;
    case 'expression':
      return source.expression;
    default:
      return 'null';
  }
}

function compileNode(
  node: TreeNode,
  passthrough: boolean,
  segmentName: string,
): string {
  if (node.leaf && node.children.size === 0) {
    return compileSource(node.leaf);
  }

  const pairs: string[] = [];
  for (const [key, child] of node.children) {
    pairs.push(`"${key}": ${compileNode(child, passthrough, key)}`);
  }
  const obj = `{${pairs.join(', ')}}`;

  // Overlapping paths: the user set both `metadata` and `metadata.name`. Treat
  // the leaf as the base object and merge children on top — neither side is
  // silently dropped. (For scalar literal leaves this will fail at JSONata
  // runtime; that's a separate UX concern to surface in the builder.)
  if (node.leaf) {
    return `$merge([${compileSource(node.leaf)}, ${obj}])`;
  }

  if (passthrough) {
    return `$merge([${segmentName}, ${obj}])`;
  }
  return obj;
}

/**
 * Build the JSONata expression for the passthrough source — either bare `$`
 * or a `$sift` filtering out the omitted top-level keys.
 */
export function compilePassthroughSource(omit: string[] | undefined): string {
  const keys = (omit ?? []).filter(k => k.length > 0);
  if (keys.length === 0) {
    return '$';
  }
  const list = keys.map(k => `"${escapeString(k)}"`).join(', ');
  return `$sift($, function($v, $k) { $not($k in [${list}]) })`;
}

export function compileMap(rules: MapRules): string {
  const validOverrides = rules.overrides.filter(
    o => o.targetPath.split('.').filter(Boolean).length > 0,
  );
  const passthroughSource = rules.passthrough
    ? compilePassthroughSource(rules.omit)
    : '$';

  if (validOverrides.length === 0) {
    return rules.passthrough ? passthroughSource : '{}';
  }

  const root = makeNode();
  for (const override of validOverrides) {
    insert(root, override);
  }
  return compileNode(root, rules.passthrough, passthroughSource);
}
