import { describe, it, expect } from 'vitest';
import { compileMap } from './compile-map';
import type { MapRules } from './types';

describe('compileMap', () => {
  it('returns the identity expression when passthrough is on with no overrides', () => {
    expect(compileMap({ passthrough: true, overrides: [] })).toBe('$');
  });

  it('returns an empty object when passthrough is off with no overrides', () => {
    expect(compileMap({ passthrough: false, overrides: [] })).toBe('{}');
  });

  it('compiles a single flat literal override with passthrough', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    expect(compileMap(rules)).toBe('$merge([$, {"kind": "Component"}])');
  });

  it('compiles multiple flat literal overrides with passthrough', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
        {
          id: '2',
          targetPath: 'count',
          source: { kind: 'literal', valueType: 'number', value: 5 },
        },
        {
          id: '3',
          targetPath: 'active',
          source: { kind: 'literal', valueType: 'boolean', value: true },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '$merge([$, {"kind": "Component", "count": 5, "active": true}])',
    );
  });

  it('compiles a null literal override', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'note',
          source: { kind: 'literal', valueType: 'null', value: null },
        },
      ],
    };
    expect(compileMap(rules)).toBe('$merge([$, {"note": null}])');
  });

  it('compiles a field passthrough override', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'displayName',
          source: { kind: 'field', path: 'metadata.name' },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '$merge([$, {"displayName": metadata.name}])',
    );
  });

  it('compiles a raw expression override verbatim', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'total',
          source: { kind: 'expression', expression: '$count(items)' },
        },
      ],
    };
    expect(compileMap(rules)).toBe('$merge([$, {"total": $count(items)}])');
  });

  it('compiles a nested dot-path override into a recursive $merge', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'metadata.namespace',
          source: { kind: 'literal', valueType: 'string', value: 'default' },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '$merge([$, {"metadata": $merge([metadata, {"namespace": "default"}])}])',
    );
  });

  it('groups multiple overrides under the same parent', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'metadata.namespace',
          source: { kind: 'literal', valueType: 'string', value: 'default' },
        },
        {
          id: '2',
          targetPath: 'metadata.name',
          source: { kind: 'literal', valueType: 'string', value: 'thing' },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '$merge([$, {"metadata": $merge([metadata, {"namespace": "default", "name": "thing"}])}])',
    );
  });

  it('compiles deeply nested paths', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'spec.template.namespace',
          source: { kind: 'literal', valueType: 'string', value: 'prod' },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '$merge([$, {"spec": $merge([spec, {"template": $merge([template, {"namespace": "prod"}])}])}])',
    );
  });

  it('combines flat and nested overrides at the top level', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'API' },
        },
        {
          id: '2',
          targetPath: 'metadata.namespace',
          source: { kind: 'literal', valueType: 'string', value: 'default' },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '$merge([$, {"kind": "API", "metadata": $merge([metadata, {"namespace": "default"}])}])',
    );
  });

  it('emits a plain object construction when passthrough is off', () => {
    const rules: MapRules = {
      passthrough: false,
      overrides: [
        {
          id: '1',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
        {
          id: '2',
          targetPath: 'count',
          source: { kind: 'literal', valueType: 'number', value: 3 },
        },
      ],
    };
    expect(compileMap(rules)).toBe('{"kind": "Component", "count": 3}');
  });

  it('emits a plain nested object construction when passthrough is off', () => {
    const rules: MapRules = {
      passthrough: false,
      overrides: [
        {
          id: '1',
          targetPath: 'metadata.namespace',
          source: { kind: 'literal', valueType: 'string', value: 'default' },
        },
      ],
    };
    expect(compileMap(rules)).toBe('{"metadata": {"namespace": "default"}}');
  });

  it('escapes special characters in string literals', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: 'note',
          source: {
            kind: 'literal',
            valueType: 'string',
            value: 'has "quotes" and \\ backslash',
          },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '$merge([$, {"note": "has \\"quotes\\" and \\\\ backslash"}])',
    );
  });

  it('preserves both leaf and child overrides when paths overlap', () => {
    // User sets both `metadata` (object expression) AND `metadata.name`.
    // Neither override is silently dropped: leaf becomes the merge base,
    // children are merged on top.
    const rules: MapRules = {
      passthrough: false,
      overrides: [
        {
          id: '1',
          targetPath: 'metadata',
          source: { kind: 'field', path: 'metadata' },
        },
        {
          id: '2',
          targetPath: 'metadata.name',
          source: { kind: 'literal', valueType: 'string', value: 'override' },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '{"metadata": $merge([metadata, {"name": "override"}])}',
    );
  });

  it('emits $sift around the passthrough when omit has entries', () => {
    // Passthrough with omit only (no overrides): sift the input.
    const rules: MapRules = {
      passthrough: true,
      omit: ['permissions'],
      overrides: [],
    };
    expect(compileMap(rules)).toBe(
      '$sift($, function($v, $k) { $not($k in ["permissions"]) })',
    );
  });

  it('emits $sift inside the merge when omit and overrides are both present', () => {
    const rules: MapRules = {
      passthrough: true,
      omit: ['permissions', 'description'],
      overrides: [
        {
          id: '1',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    expect(compileMap(rules)).toBe(
      '$merge([$sift($, function($v, $k) { $not($k in ["permissions", "description"]) }), {"kind": "Component"}])',
    );
  });

  it('ignores omit when passthrough is off', () => {
    const rules: MapRules = {
      passthrough: false,
      omit: ['permissions'],
      overrides: [
        {
          id: '1',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    // No passthrough → omit is meaningless.
    expect(compileMap(rules)).toBe('{"kind": "Component"}');
  });

  it('treats empty omit array the same as no omit', () => {
    const rules: MapRules = {
      passthrough: true,
      omit: [],
      overrides: [
        {
          id: '1',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    expect(compileMap(rules)).toBe('$merge([$, {"kind": "Component"}])');
  });

  it('returns identity when passthrough is on with empty omit and no overrides', () => {
    const rules: MapRules = {
      passthrough: true,
      omit: [],
      overrides: [],
    };
    expect(compileMap(rules)).toBe('$');
  });

  it('skips overrides with empty target paths', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: '1',
          targetPath: '',
          source: { kind: 'literal', valueType: 'string', value: 'ignored' },
        },
        {
          id: '2',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    expect(compileMap(rules)).toBe('$merge([$, {"kind": "Component"}])');
  });
});
