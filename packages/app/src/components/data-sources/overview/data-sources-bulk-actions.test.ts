import { describe, expect, it } from 'vitest';
import type { DataSourceItem } from '../types';
import {
  getBulkEnablePartialReason,
  getBulkRunPartialReason,
} from './data-sources-bulk-actions';

function mockDataSource(
  id: string,
  overrides: Partial<DataSourceItem> = {},
): DataSourceItem {
  return {
    id,
    name: id,
    enabled: true,
    ...overrides,
  } as DataSourceItem;
}

describe('bulk partial reasons', () => {
  it('explains why some selected data sources cannot be run', () => {
    const selected = [
      mockDataSource('a', { enabled: true }),
      mockDataSource('b', { enabled: false }),
      mockDataSource('c', { enabled: true }),
    ];

    const reason = getBulkRunPartialReason(
      selected,
      ['a'],
      () => undefined,
      new Set(),
    );

    expect(reason).toEqual({
      summary: 'Not possible for 2 of 3 selected',
      blocks: [{ reason: 'Must be enabled to run', count: 1 }],
    });
  });

  it('aggregates matching blockers and includes integration details', () => {
    const selected = [
      mockDataSource('a', { enabled: false }),
      mockDataSource('b', {
        enabled: false,
        integration: {
          label: 'GitHub',
          type: 'github',
          icon: '',
          color: '',
          logoUrl: '',
        },
      }),
      mockDataSource('c', { enabled: true }),
      mockDataSource('d', { enabled: true }),
    ];

    const reason = getBulkEnablePartialReason(
      selected,
      ['a'],
      ds => (ds.id === 'b' ? 'Integration configuration required' : undefined),
      new Set(),
    );

    expect(reason).toEqual({
      summary: 'Not possible for 3 of 4 selected',
      blocks: [
        { reason: 'Already enabled', count: 2 },
        {
          label: 'GitHub',
          reason: 'Integration configuration required',
          count: 1,
        },
      ],
    });
  });

  it('returns undefined when every selected item is eligible', () => {
    const selected = [mockDataSource('a'), mockDataSource('b')];

    expect(
      getBulkRunPartialReason(selected, ['a', 'b'], () => undefined, new Set()),
    ).toBeUndefined();
  });
});
