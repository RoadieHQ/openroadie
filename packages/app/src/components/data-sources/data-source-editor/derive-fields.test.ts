import { describe, it, expect } from 'vitest';
import { deriveFields } from './derive-fields';

describe('deriveFields', () => {
  it('returns [] for undefined sample', () => {
    expect(deriveFields(undefined)).toEqual([]);
  });

  it('returns [] for empty sample', () => {
    expect(deriveFields([])).toEqual([]);
  });

  it('returns flat fields for a flat object sample', () => {
    const fields = deriveFields([
      { kind: 'Component', count: 3, active: true },
    ]);
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'kind',
          label: 'kind',
          inputType: 'text',
        }),
        expect.objectContaining({
          name: 'count',
          label: 'count',
          inputType: 'number',
        }),
        expect.objectContaining({
          name: 'active',
          label: 'active',
          valueEditorType: 'checkbox',
        }),
      ]),
    );
    expect(fields).toHaveLength(3);
  });

  it('flattens nested objects to dot-paths', () => {
    const fields = deriveFields([
      { metadata: { name: 'foo', namespace: 'default' } },
    ]);
    const names = fields.map(f => f.name);
    expect(names).toContain('metadata.name');
    expect(names).toContain('metadata.namespace');
    expect(names).not.toContain('metadata');
  });

  it('handles deeply nested objects', () => {
    const fields = deriveFields([{ a: { b: { c: 'deep' } } }]);
    expect(fields.map(f => f.name)).toEqual(['a.b.c']);
  });

  it('skips arrays-of-objects (no leaf type)', () => {
    const fields = deriveFields([{ tags: [{ key: 'a', value: 'b' }] }]);
    expect(fields.map(f => f.name)).not.toContain('tags');
  });

  it('skips arrays-of-arrays', () => {
    const fields = deriveFields([{ matrix: [[1, 2]] }]);
    expect(fields).toEqual([]);
  });

  it('falls back to text for mixed-type fields across items', () => {
    const fields = deriveFields([{ count: 1 }, { count: 'one' }]);
    const f = fields.find(x => x.name === 'count');
    expect(f).toBeDefined();
    expect(f?.inputType).toBe('text');
  });

  it('detects ISO date strings as date input', () => {
    const fields = deriveFields([{ updatedAt: '2024-01-15' }]);
    const f = fields.find(x => x.name === 'updatedAt');
    expect(f?.inputType).toBe('date');
  });

  it('detects ISO date-time strings as date input', () => {
    const fields = deriveFields([{ ts: '2024-01-15T10:00:00Z' }]);
    const f = fields.find(x => x.name === 'ts');
    expect(f?.inputType).toBe('date');
  });

  it('marks low-cardinality string fields as select with values', () => {
    const sample = Array.from({ length: 10 }, (_, i) => ({
      kind: i < 5 ? 'Component' : 'API',
    }));
    const fields = deriveFields(sample);
    const kind = fields.find(x => x.name === 'kind');
    expect(kind?.valueEditorType).toBe('select');
    const values = kind?.values as
      | Array<{ name?: string; label?: string }>
      | undefined;
    const valueNames = values?.map(v => v.name);
    expect(valueNames).toEqual(expect.arrayContaining(['Component', 'API']));
  });

  it('does not mark high-cardinality string fields as select', () => {
    // 11 distinct values exceeds the default enumMaxValues of 10.
    const sample = Array.from({ length: 11 }, (_, i) => ({
      title: `unique-${i}`,
    }));
    const fields = deriveFields(sample);
    const title = fields.find(x => x.name === 'title');
    expect(title?.valueEditorType).toBeUndefined();
    expect(title?.inputType).toBe('text');
  });

  it('respects custom enumMaxValues option', () => {
    const sample = Array.from({ length: 10 }, (_, i) => ({
      label: `label-${i % 3}`,
    }));
    const fieldsDefault = deriveFields(sample);
    expect(fieldsDefault.find(f => f.name === 'label')?.valueEditorType).toBe(
      'select',
    );

    const fieldsTight = deriveFields(sample, { enumMaxValues: 2 });
    expect(
      fieldsTight.find(f => f.name === 'label')?.valueEditorType,
    ).toBeUndefined();
  });

  it('treats enumMaxValues as inclusive (exact-boundary case is still an enum)', () => {
    // 3 distinct values, enumMaxValues: 3 → should still be an enum
    const sample = Array.from({ length: 9 }, (_, i) => ({
      label: `label-${i % 3}`,
    }));
    const fields = deriveFields(sample, { enumMaxValues: 3 });
    expect(fields.find(f => f.name === 'label')?.valueEditorType).toBe(
      'select',
    );
  });

  it('filters out _parent and _additionalData internal pipeline keys', () => {
    const fields = deriveFields([
      {
        kind: 'Component',
        _parent: { id: 'p1' },
        _additionalData: { stuff: [] },
      },
    ]);
    const names = fields.map(f => f.name);
    expect(names).toContain('kind');
    expect(names.some(n => n.startsWith('_parent'))).toBe(false);
    expect(names.some(n => n.startsWith('_additionalData'))).toBe(false);
  });

  it('attaches type-appropriate operators for string fields', () => {
    const fields = deriveFields([{ kind: 'Component' }]);
    const ops = (
      fields.find(f => f.name === 'kind')?.operators as
        | Array<{ name?: string }>
        | undefined
    )?.map(o => o.name);
    expect(ops).toEqual(
      expect.arrayContaining([
        '=',
        '!=',
        'contains',
        'doesNotContain',
        'beginsWith',
        'endsWith',
        'in',
        'notIn',
        'null',
        'notNull',
      ]),
    );
  });

  it('attaches numeric operators for number fields', () => {
    const fields = deriveFields([{ count: 1 }]);
    const ops = (
      fields.find(f => f.name === 'count')?.operators as
        | Array<{ name?: string }>
        | undefined
    )?.map(o => o.name);
    expect(ops).toEqual(
      expect.arrayContaining(['=', '!=', '<', '<=', '>', '>=', 'in', 'notIn']),
    );
    expect(ops).not.toContain('contains');
  });

  it('attaches minimal operators for boolean fields', () => {
    const fields = deriveFields([{ active: true }]);
    const ops = (
      fields.find(f => f.name === 'active')?.operators as
        | Array<{ name?: string }>
        | undefined
    )?.map(o => o.name);
    expect(ops).toEqual(['=', '!=']);
  });

  it('attaches enum operator subset for select fields', () => {
    const sample = Array.from({ length: 10 }, (_, i) => ({
      kind: i < 5 ? 'A' : 'B',
    }));
    const fields = deriveFields(sample);
    const ops = (
      fields.find(f => f.name === 'kind')?.operators as
        | Array<{ name?: string }>
        | undefined
    )?.map(o => o.name);
    expect(ops).toEqual(['=', '!=', 'in', 'notIn']);
  });
});
