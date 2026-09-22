import { describe, expect, it } from 'vitest';
import {
  applyResolvedHttpPagination,
  resolveHttpPagination,
} from './httpPagination';

describe('httpPagination', () => {
  it('preserves legacy pagination config when no paginationMode is set', () => {
    expect(
      resolveHttpPagination({
        pagination: {
          type: 'none',
        },
      }),
    ).toEqual({
      pagination: {
        type: 'none',
      },
    });
  });

  it('uses the effective default in inherit mode', () => {
    expect(
      resolveHttpPagination({
        paginationMode: 'inherit',
        effectivePaginationDefault: {
          type: 'link',
          perPageParam: 'per_page',
          perPage: 100,
        },
      }),
    ).toEqual({
      pagination: {
        type: 'link',
        perPageParam: 'per_page',
        perPage: 100,
      },
      disableImplicitPagination: undefined,
    });
  });

  it('falls back to the integration default in inherit mode', () => {
    expect(
      resolveHttpPagination(
        {
          paginationMode: 'inherit',
        },
        {
          type: 'page',
          pageParam: 'page',
          perPageParam: 'per_page',
          perPage: 100,
          startPage: 1,
        },
      ),
    ).toEqual({
      pagination: {
        type: 'page',
        pageParam: 'page',
        perPageParam: 'per_page',
        perPage: 100,
        startPage: 1,
      },
      disableImplicitPagination: undefined,
    });
  });

  it('disables implicit pagination in disabled mode', () => {
    expect(
      applyResolvedHttpPagination({
        paginationMode: 'disabled',
        pagination: {
          type: 'link',
          perPageParam: 'per_page',
          perPage: 100,
        },
      }),
    ).toEqual({
      config: {
        paginationMode: 'disabled',
        pagination: {
          type: 'none',
        },
      },
      disableImplicitPagination: true,
    });
  });

  it('does not strip legacy pagination when inherit mode has no effective default', () => {
    const legacy = {
      paginationMode: 'inherit' as const,
      pagination: {
        type: 'page' as const,
        pageParam: 'page',
        perPageParam: 'per_page',
        perPage: 25,
        startPage: 1,
      },
    };

    expect(applyResolvedHttpPagination(legacy)).toEqual({
      config: legacy,
      disableImplicitPagination: undefined,
    });
  });
});
