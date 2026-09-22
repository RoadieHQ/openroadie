import { describe, expect, it } from 'vitest';
import {
  datastoreSortParam,
  readDatastoreSortFromParams,
} from './datastore-sort-param';

const read = (search: string) =>
  readDatastoreSortFromParams(new URLSearchParams(search));

describe('readDatastoreSortFromParams', () => {
  it('reads an ascending sort', () => {
    expect(read('?sort=title')).toEqual([{ id: 'title', desc: false }]);
  });

  it('reads a descending sort from the leading dash', () => {
    expect(read('?sort=-relationshipCount')).toEqual([
      { id: 'relationshipCount', desc: true },
    ]);
  });

  it('reads an index key with dots', () => {
    expect(read('?sort=-presentation.subtitle')).toEqual([
      { id: 'presentation.subtitle', desc: true },
    ]);
  });

  it('is unsorted when the param is absent, blank or just a dash', () => {
    expect(read('')).toEqual([]);
    expect(read('?sort=')).toEqual([]);
    expect(read('?sort=%20')).toEqual([]);
    expect(read('?sort=-')).toEqual([]);
  });
});

describe('datastoreSortParam', () => {
  it('round-trips both directions', () => {
    for (const value of ['title', '-title', '-presentation.subtitle']) {
      expect(datastoreSortParam(read(`?sort=${value}`))).toBe(value);
    }
  });

  it('is null when unsorted, so the caller deletes the param', () => {
    expect(datastoreSortParam([])).toBeNull();
    expect(datastoreSortParam([{ id: '', desc: false }])).toBeNull();
  });
});
