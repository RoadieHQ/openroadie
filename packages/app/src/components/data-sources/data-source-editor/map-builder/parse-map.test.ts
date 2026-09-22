import { describe, it, expect } from 'vitest';
import { parseMapRules } from './parse-map';

describe('parseMapRules', () => {
  it('parses the bare identity expression', () => {
    expect(parseMapRules('$')).toEqual({
      passthrough: true,
      overrides: [],
    });
  });

  it('parses an empty object construction as no-passthrough no-overrides', () => {
    expect(parseMapRules('{}')).toEqual({
      passthrough: false,
      overrides: [],
    });
  });

  it('parses a flat passthrough $merge with a string literal override', () => {
    const rules = parseMapRules('$merge([$, {"kind": "Component"}])');
    expect(rules?.passthrough).toBe(true);
    expect(rules?.overrides).toHaveLength(1);
    expect(rules?.overrides[0]).toEqual(
      expect.objectContaining({
        targetPath: 'kind',
        source: { kind: 'literal', valueType: 'string', value: 'Component' },
      }),
    );
  });

  it('parses multiple flat passthrough overrides preserving order', () => {
    const rules = parseMapRules(
      '$merge([$, {"kind": "Component", "count": 5, "active": true}])',
    );
    expect(rules?.passthrough).toBe(true);
    expect(rules?.overrides.map(o => o.targetPath)).toEqual([
      'kind',
      'count',
      'active',
    ]);
    expect(rules?.overrides.map(o => o.source)).toEqual([
      { kind: 'literal', valueType: 'string', value: 'Component' },
      { kind: 'literal', valueType: 'number', value: 5 },
      { kind: 'literal', valueType: 'boolean', value: true },
    ]);
  });

  it('parses a null literal override', () => {
    const rules = parseMapRules('$merge([$, {"note": null}])');
    expect(rules?.overrides[0]?.source).toEqual({
      kind: 'literal',
      valueType: 'null',
      value: null,
    });
  });

  it('parses a field passthrough as a field source', () => {
    const rules = parseMapRules('$merge([$, {"alias": metadata.name}])');
    expect(rules?.overrides[0]?.source).toEqual({
      kind: 'field',
      path: 'metadata.name',
    });
  });

  it('parses a single-segment field reference (bare identifier) as a field source', () => {
    // Single-segment identifiers come back from the JSONata AST as `name`
    // nodes, not `path` nodes. Make sure round-trip still works.
    const rules = parseMapRules('$merge([$, {"alias": kind}])');
    expect(rules?.overrides[0]?.source).toEqual({
      kind: 'field',
      path: 'kind',
    });
  });

  it('parses nested $merge into a dot-path override', () => {
    const rules = parseMapRules(
      '$merge([$, {"metadata": $merge([metadata, {"namespace": "default"}])}])',
    );
    expect(rules?.passthrough).toBe(true);
    expect(rules?.overrides).toHaveLength(1);
    expect(rules?.overrides[0]).toEqual(
      expect.objectContaining({
        targetPath: 'metadata.namespace',
        source: { kind: 'literal', valueType: 'string', value: 'default' },
      }),
    );
  });

  it('parses deeply nested $merge into a multi-segment dot-path override', () => {
    const rules = parseMapRules(
      '$merge([$, {"spec": $merge([spec, {"template": $merge([template, {"namespace": "prod"}])}])}])',
    );
    expect(rules?.overrides[0]?.targetPath).toBe('spec.template.namespace');
  });

  it('parses mixed flat and nested overrides under passthrough', () => {
    const rules = parseMapRules(
      '$merge([$, {"kind": "API", "metadata": $merge([metadata, {"namespace": "default"}])}])',
    );
    expect(rules?.overrides.map(o => o.targetPath)).toEqual([
      'kind',
      'metadata.namespace',
    ]);
  });

  it('parses a plain object construction as no-passthrough overrides', () => {
    const rules = parseMapRules('{"kind": "Component", "count": 3}');
    expect(rules?.passthrough).toBe(false);
    expect(rules?.overrides.map(o => o.targetPath)).toEqual(['kind', 'count']);
  });

  it('returns null for an unparseable expression (lambda)', () => {
    expect(parseMapRules('$map(items, function($i){$i.kind})')).toBeNull();
  });

  it('returns null for $merge whose first arg is not the identity', () => {
    // First arg is `entity` (a path), not `$` — we don't recognize this.
    expect(parseMapRules('$merge([entity, {"k": "v"}])')).toBeNull();
  });

  it('returns null for nested $merge whose path does not match the key', () => {
    expect(
      parseMapRules(
        '$merge([$, {"metadata": $merge([other, {"namespace": "default"}])}])',
      ),
    ).toBeNull();
  });

  it('returns null when an override value is a function call we cannot represent', () => {
    expect(parseMapRules('$merge([$, {"total": $count(items)}])')).toBeNull();
  });

  it('returns null for syntactically invalid JSONata', () => {
    expect(parseMapRules('$merge([$, {')).toBeNull();
  });

  it('parses bare $sift as passthrough with omit (no overrides)', () => {
    const expr =
      '$sift($, function($v, $k) { $not($k in ["permissions", "description"]) })';
    const parsed = parseMapRules(expr);
    expect(parsed?.passthrough).toBe(true);
    expect(parsed?.omit).toEqual(['permissions', 'description']);
    expect(parsed?.overrides).toHaveLength(0);
  });

  it('parses $merge wrapping a $sift as passthrough + omit + overrides', () => {
    const expr =
      '$merge([$sift($, function($v, $k) { $not($k in ["permissions"]) }), {"kind": "Component"}])';
    const parsed = parseMapRules(expr);
    expect(parsed?.passthrough).toBe(true);
    expect(parsed?.omit).toEqual(['permissions']);
    expect(parsed?.overrides).toHaveLength(1);
    expect(parsed?.overrides[0]?.targetPath).toBe('kind');
  });

  it('round-trips compileMap output with omit through parseMapRules', async () => {
    const { compileMap } = await import('./compile-map');
    const rules = {
      passthrough: true,
      omit: ['permissions', 'description'],
      overrides: [
        {
          id: '1',
          targetPath: 'kind',
          source: {
            kind: 'literal' as const,
            valueType: 'string' as const,
            value: 'Component',
          },
        },
      ],
    };
    const parsed = parseMapRules(compileMap(rules));
    expect(parsed?.passthrough).toBe(true);
    expect(parsed?.omit).toEqual(['permissions', 'description']);
    expect(parsed?.overrides).toHaveLength(1);
    expect(parsed?.overrides[0]?.targetPath).toBe('kind');
  });

  it('round-trips compileMap output back through parseMapRules', async () => {
    const { compileMap } = await import('./compile-map');
    const rules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'metadata.namespace',
          source: {
            kind: 'literal' as const,
            valueType: 'string' as const,
            value: 'default',
          },
        },
        {
          id: '2',
          targetPath: 'kind',
          source: {
            kind: 'literal' as const,
            valueType: 'string' as const,
            value: 'API',
          },
        },
      ],
    };
    const compiled = compileMap(rules);
    const parsed = parseMapRules(compiled);
    expect(parsed?.passthrough).toBe(true);
    expect(parsed?.overrides).toHaveLength(2);
    const targets = parsed?.overrides.map(o => o.targetPath).sort();
    expect(targets).toEqual(['kind', 'metadata.namespace']);
  });
});
