import { describe, expect, it } from 'vitest';
import { dataSourceObjectsColumnHeadClass } from './data-source-objects-table-layout';

describe('dataSourceObjectsColumnHeadClass', () => {
  it('caps the title column when index columns share the row', () => {
    expect(
      dataSourceObjectsColumnHeadClass('title', { hasIndexColumns: true }),
    ).toContain('w-[32%]');
  });

  it('lets title absorb the remaining width when there are no index columns', () => {
    const className = dataSourceObjectsColumnHeadClass('title', {
      hasIndexColumns: false,
    });
    expect(className).not.toContain('w-[32%]');
  });

  it('keeps the chrome columns at fixed widths regardless of index columns', () => {
    for (const hasIndexColumns of [true, false]) {
      expect(
        dataSourceObjectsColumnHeadClass('expand', { hasIndexColumns }),
      ).toContain('w-8');
      expect(
        dataSourceObjectsColumnHeadClass('subtitle', { hasIndexColumns }),
      ).toContain('w-[14rem]');
      expect(
        dataSourceObjectsColumnHeadClass('relationshipCount', {
          hasIndexColumns,
        }),
      ).toContain('w-36');
      expect(
        dataSourceObjectsColumnHeadClass('contextGroups', {
          hasIndexColumns,
        }),
      ).toContain('w-[16rem]');
    }
  });

  it('keeps identifier-like index columns compact', () => {
    expect(
      dataSourceObjectsColumnHeadClass('id', { hasIndexColumns: true }),
    ).toContain('w-[8.5rem]');
    expect(
      dataSourceObjectsColumnHeadClass('teamId', { hasIndexColumns: true }),
    ).toContain('w-[8.5rem]');
    expect(
      dataSourceObjectsColumnHeadClass('external_id', {
        hasIndexColumns: true,
      }),
    ).toContain('w-[8.5rem]');
  });

  it('reserves fixed widths for trailing columns in the All view', () => {
    expect(
      dataSourceObjectsColumnHeadClass('title', {
        hasIndexColumns: false,
        hasDataSourceColumn: true,
      }),
    ).toContain('w-[26%]');
    expect(
      dataSourceObjectsColumnHeadClass('dataSource', {
        hasIndexColumns: false,
        hasDataSourceColumn: true,
      }),
    ).toContain('w-[13rem]');
    expect(
      dataSourceObjectsColumnHeadClass('relationshipCount', {
        hasIndexColumns: false,
        hasDataSourceColumn: true,
      }),
    ).toContain('w-[10rem]');
  });
});
