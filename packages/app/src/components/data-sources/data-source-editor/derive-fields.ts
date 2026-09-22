import type { Field, FlexibleOption } from 'react-querybuilder';
import {
  ISO_DATETIME_RE,
  ISO_DATE_ONLY_RE,
} from '@roadiehq/catalog-datastore-common';

export interface DeriveFieldsOptions {
  enumMinValues?: number;
  enumMaxValues?: number;
}

const DEFAULT_OPTS: Required<DeriveFieldsOptions> = {
  enumMinValues: 2,
  enumMaxValues: 10,
};

const SKIP_KEYS = new Set(['_parent', '_additionalData']);

type LeafType = 'string' | 'number' | 'boolean' | 'date';

interface PathStats {
  types: Set<LeafType>;
  /** Distinct values for string fields; null once we exceed the cap or see non-string. */
  stringValues: Set<string> | null;
}

function classifyValue(value: unknown): LeafType | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    if (ISO_DATE_ONLY_RE.test(value) || ISO_DATETIME_RE.test(value)) {
      return 'date';
    }
    return 'string';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function walk(
  value: unknown,
  path: string,
  stats: Map<string, PathStats>,
  enumMaxValues: number,
): void {
  if (Array.isArray(value)) {
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) {
        continue;
      }
      const nextPath = path ? `${path}.${key}` : key;
      walk(child, nextPath, stats, enumMaxValues);
    }
    return;
  }

  if (!path) {
    return;
  }

  const leaf = classifyValue(value);
  if (!leaf) {
    return;
  }

  let entry = stats.get(path);
  if (!entry) {
    entry = { types: new Set(), stringValues: new Set() };
    stats.set(path, entry);
  }
  entry.types.add(leaf);

  if (leaf === 'string' && entry.stringValues) {
    entry.stringValues.add(String(value));
    if (entry.stringValues.size > enumMaxValues) {
      entry.stringValues = null;
    }
  } else if (leaf !== 'string') {
    entry.stringValues = null;
  }
}

const STRING_OPERATORS: FlexibleOption[] = [
  { name: '=', label: '=' },
  { name: '!=', label: '!=' },
  { name: 'contains', label: 'contains' },
  { name: 'doesNotContain', label: 'not contains' },
  { name: 'beginsWith', label: 'begins with' },
  { name: 'endsWith', label: 'ends with' },
  { name: 'in', label: 'in' },
  { name: 'notIn', label: 'not in' },
  { name: 'null', label: 'is empty' },
  { name: 'notNull', label: 'is not empty' },
];

const ENUM_OPERATORS: FlexibleOption[] = [
  { name: '=', label: '=' },
  { name: '!=', label: '!=' },
  { name: 'in', label: 'in' },
  { name: 'notIn', label: 'not in' },
];

const NUMBER_OPERATORS: FlexibleOption[] = [
  { name: '=', label: '=' },
  { name: '!=', label: '!=' },
  { name: '<', label: '<' },
  { name: '<=', label: '<=' },
  { name: '>', label: '>' },
  { name: '>=', label: '>=' },
  { name: 'in', label: 'in' },
  { name: 'notIn', label: 'not in' },
  { name: 'null', label: 'is empty' },
  { name: 'notNull', label: 'is not empty' },
];

const BOOLEAN_OPERATORS: FlexibleOption[] = [
  { name: '=', label: '=' },
  { name: '!=', label: '!=' },
];

const DATE_OPERATORS: FlexibleOption[] = [
  { name: '=', label: '=' },
  { name: '<', label: 'before' },
  { name: '<=', label: 'on or before' },
  { name: '>', label: 'after' },
  { name: '>=', label: 'on or after' },
];

function pickSingleType(types: Set<LeafType>): LeafType | 'mixed' {
  if (types.size !== 1) {
    return 'mixed';
  }
  return types.values().next().value as LeafType;
}

function buildField(
  path: string,
  stats: PathStats,
  opts: Required<DeriveFieldsOptions>,
): Field {
  const t = pickSingleType(stats.types);
  const base: Field = { name: path, label: path };

  if (t === 'mixed' || t === 'string') {
    const distinct = stats.stringValues;
    if (t === 'string' && distinct && distinct.size >= opts.enumMinValues) {
      const sorted = [...distinct].sort();
      return {
        ...base,
        inputType: 'text',
        valueEditorType: 'select',
        operators: ENUM_OPERATORS,
        values: sorted.map(v => ({ name: v, label: v })),
        defaultValue: sorted[0] ?? '',
      };
    }
    return {
      ...base,
      inputType: 'text',
      operators: STRING_OPERATORS,
      defaultValue: '',
    };
  }

  if (t === 'number') {
    return {
      ...base,
      inputType: 'number',
      operators: NUMBER_OPERATORS,
      defaultValue: 0,
    };
  }

  if (t === 'boolean') {
    return {
      ...base,
      valueEditorType: 'checkbox',
      operators: BOOLEAN_OPERATORS,
      defaultValue: false,
    };
  }

  return {
    ...base,
    inputType: 'date',
    operators: DATE_OPERATORS,
    defaultValue: '',
  };
}

export function deriveFields(
  sample: unknown[] | undefined,
  options?: DeriveFieldsOptions,
): Field[] {
  if (!sample || sample.length === 0) {
    return [];
  }
  const opts = { ...DEFAULT_OPTS, ...options };
  const stats = new Map<string, PathStats>();
  for (const item of sample) {
    walk(item, '', stats, opts.enumMaxValues);
  }
  const fields: Field[] = [];
  for (const [path, s] of stats) {
    fields.push(buildField(path, s, opts));
  }
  fields.sort((a, b) => a.name.localeCompare(b.name));
  return fields;
}
