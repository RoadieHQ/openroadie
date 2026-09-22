import { describe, expect, it } from 'vitest';
import {
  isCrossSourceScope,
  readDatastoreScopeFromParams,
} from './datastore-scope-param';
import { dataSourceObjectsColumnWidths } from './data-source-objects-table-layout';

const scopeOf = (search: string) =>
  readDatastoreScopeFromParams(new URLSearchParams(search));

describe('readDatastoreScopeFromParams', () => {
  it('reads a csv scope', () => {
    expect(scopeOf('?ds=ds-1,ds-2')).toEqual(['ds-1', 'ds-2']);
  });

  it('treats an absent or empty ds param as every data source', () => {
    expect(scopeOf('')).toEqual([]);
    expect(scopeOf('?ds=')).toEqual([]);
  });

  it('resolves a legacy dataSourceId deep link', () => {
    expect(scopeOf('?dataSourceId=ds-1')).toEqual(['ds-1']);
  });

  it('maps the legacy all sentinel to the unscoped view', () => {
    expect(scopeOf('?dataSourceId=all')).toEqual([]);
  });

  it('prefers ds over the legacy param', () => {
    expect(scopeOf('?ds=ds-2&dataSourceId=ds-1')).toEqual(['ds-2']);
  });
});

describe('isCrossSourceScope', () => {
  it('is true for every scope except exactly one source', () => {
    expect(isCrossSourceScope([])).toBe(true);
    expect(isCrossSourceScope(['ds-1', 'ds-2'])).toBe(true);
    expect(isCrossSourceScope(['ds-1'])).toBe(false);
  });

  it('treats a lone context-group rule as cross-source', () => {
    // Group rows span data sources, so a `cg:` scope never unlocks the
    // per-datasource columns — and the Suspense skeleton must match.
    expect(isCrossSourceScope(['cg:rule-1'])).toBe(true);
  });
});

describe('dataSourceObjectsColumnWidths', () => {
  it('adds the Data source column in cross-source mode', () => {
    expect(dataSourceObjectsColumnWidths(false)).toHaveLength(5);
    expect(dataSourceObjectsColumnWidths(true)).toHaveLength(6);
  });

  it('reuses the live header width classes', () => {
    // Matching classes are what make the Suspense skeleton line up with the
    // real table rather than merely look like a table.
    expect(dataSourceObjectsColumnWidths(true)).toContain(
      'w-[13rem] min-w-[11rem] max-w-[13rem]',
    );
    expect(dataSourceObjectsColumnWidths(false)).toContain(
      'w-[16rem] min-w-[12rem] max-w-[16rem]',
    );
  });
});
