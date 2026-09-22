import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
import {
  useOverviewState,
  useLegacyTabRedirect,
  useDataSourceLegacyStatusRedirect,
  dataSourceLegacyTabTarget,
} from './use-overview-state';
import type { OverviewConfig } from './overview-config';

interface Row {
  id: string;
  name: string;
  slug: string;
  provider: string;
  active: boolean;
}

const rows: Row[] = [
  { id: '1', name: 'Alpha', slug: 'alpha', provider: 'github', active: true },
  { id: '2', name: 'Beta', slug: 'beta', provider: 'github', active: false },
  { id: '3', name: 'Gamma', slug: 'gamma', provider: 'gitlab', active: true },
];

const dynamicConfig: OverviewConfig<Row> = {
  getId: r => r.id,
  searchFields: r => [r.name, r.slug, r.provider],
  group: {
    kind: 'dynamic',
    key: r => r.provider,
    label: r => r.provider.toUpperCase(),
    logoUrl: r => `logo-${r.provider}.png`,
  },
  statuses: [
    { value: 'enabled', label: 'Enabled', predicate: r => r.active },
    { value: 'disabled', label: 'Disabled', predicate: r => !r.active },
  ],
};

const fixedConfig: OverviewConfig<Row> = {
  getId: r => r.id,
  searchFields: r => [r.name],
  group: {
    kind: 'fixed',
    key: r => r.provider,
    label: r => r.provider,
    keys: [
      { key: 'gitlab', label: 'GitLab', logoUrl: 'gl.png' },
      { key: 'github', label: 'GitHub', logoUrl: 'gh.png' },
      { key: 'bitbucket', label: 'Bitbucket' }, // always empty
    ],
  },
};

const noGroupConfig: OverviewConfig<Row> = {
  getId: r => r.id,
  searchFields: r => [r.name],
};

// Fixed categories + a predicate-based `starred` virtual group that overlaps
// them (rows 1 & 3 are starred, spanning both github and gitlab).
const starred = new Set(['1', '3']);
const virtualConfig: OverviewConfig<Row> = {
  getId: r => r.id,
  searchFields: r => [r.name],
  group: {
    kind: 'fixed',
    key: r => r.provider,
    label: r => r.provider,
    keys: [
      { key: 'github', label: 'GitHub', logoUrl: 'gh.png' },
      { key: 'gitlab', label: 'GitLab', logoUrl: 'gl.png' },
    ],
    virtual: [
      { key: 'starred', label: 'Starred', predicate: r => starred.has(r.id) },
      { key: 'archived', label: 'Archived', predicate: () => false },
    ],
  },
};

function wrapper(initialEntries: string[] = ['/']) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    );
  };
}

// Reads back the live URL search string so we can assert on the written params.
function useProbe<T>(data: T[], config: OverviewConfig<T>) {
  const state = useOverviewState(data, config);
  const [params] = useSearchParams();
  return { state, search: params.toString() };
}

describe('useOverviewState', () => {
  describe('defaults', () => {
    it('defaults group/status/search when no params present', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/']) },
      );
      expect(result.current.group).toBe('all');
      expect(result.current.status).toBe('all');
      expect(result.current.search).toBe('');
      expect(result.current.rows).toHaveLength(3);
    });

    it('reads initial values from the URL', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        {
          wrapper: wrapper(['/?group=github&status=enabled&search=alp']),
        },
      );
      expect(result.current.group).toBe('github');
      expect(result.current.status).toBe('enabled');
      expect(result.current.search).toBe('alp');
    });
  });

  describe('setters write URL + delete-on-default', () => {
    it('setGroup sets then deletes on default', () => {
      const { result } = renderHook(() => useProbe(rows, dynamicConfig), {
        wrapper: wrapper(['/']),
      });
      act(() => result.current.state.setGroup('github'));
      expect(result.current.search).toBe('group=github');
      expect(result.current.state.group).toBe('github');

      act(() => result.current.state.setGroup('all'));
      expect(result.current.search).toBe('');
      expect(result.current.state.group).toBe('all');
    });

    it('setStatus sets then deletes on default', () => {
      const { result } = renderHook(() => useProbe(rows, dynamicConfig), {
        wrapper: wrapper(['/']),
      });
      act(() => result.current.state.setStatus('enabled'));
      expect(result.current.search).toBe('status=enabled');

      act(() => result.current.state.setStatus('all'));
      expect(result.current.search).toBe('');
    });

    it('setSearch sets then deletes on empty', () => {
      const { result } = renderHook(() => useProbe(rows, dynamicConfig), {
        wrapper: wrapper(['/']),
      });
      act(() => result.current.state.setSearch('beta'));
      expect(result.current.search).toBe('search=beta');

      act(() => result.current.state.setSearch(''));
      expect(result.current.search).toBe('');
    });

    it('clear resets all three params', () => {
      const { result } = renderHook(() => useProbe(rows, dynamicConfig), {
        wrapper: wrapper(['/?group=github&status=enabled&search=x']),
      });
      act(() => result.current.state.clear());
      expect(result.current.search).toBe('');
      expect(result.current.state.group).toBe('all');
      expect(result.current.state.status).toBe('all');
      expect(result.current.state.search).toBe('');
    });
  });

  describe('filtering pipeline', () => {
    it('filters by search (case-insensitive substring)', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/?search=ALP']) },
      );
      expect(result.current.rows.map(r => r.id)).toEqual(['1']);
    });

    it('filters by status predicate', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/?status=disabled']) },
      );
      expect(result.current.rows.map(r => r.id)).toEqual(['2']);
    });

    it('filters by group key', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/?group=gitlab']) },
      );
      expect(result.current.rows.map(r => r.id)).toEqual(['3']);
    });

    it('combines search ∩ status ∩ group', () => {
      // github + enabled + search "a" → only Alpha (id 1)
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/?group=github&status=enabled&search=a']) },
      );
      expect(result.current.rows.map(r => r.id)).toEqual(['1']);
    });

    it('passes all rows for unknown status value', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/?status=bogus']) },
      );
      expect(result.current.rows).toHaveLength(3);
    });
  });

  describe('groups derivation', () => {
    it('dynamic: prepends All, one bucket per non-empty group with counts + logos', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/']) },
      );
      expect(result.current.groups).toEqual([
        { key: 'all', label: 'All', count: 3 },
        {
          key: 'github',
          label: 'GITHUB',
          count: 2,
          logoUrl: 'logo-github.png',
        },
        {
          key: 'gitlab',
          label: 'GITLAB',
          count: 1,
          logoUrl: 'logo-gitlab.png',
        },
      ]);
    });

    it('dynamic: counts reflect search-only filter, not active status/group', () => {
      // status=enabled would hide Beta, but github count must remain 2
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/?status=enabled&group=gitlab']) },
      );
      const github = result.current.groups.find(g => g.key === 'github');
      expect(github?.count).toBe(2);
      const all = result.current.groups.find(g => g.key === 'all');
      expect(all?.count).toBe(3);
    });

    it('dynamic: hides groups emptied by the search filter', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/?search=gamma']) },
      );
      expect(result.current.groups.map(g => g.key)).toEqual(['all', 'gitlab']);
      expect(result.current.groups[0].count).toBe(1);
    });

    it('fixed: iterates declared keys in order, hides empty ones', () => {
      const { result } = renderHook(() => useOverviewState(rows, fixedConfig), {
        wrapper: wrapper(['/']),
      });
      // declared order gitlab, github, bitbucket; bitbucket empty → hidden
      expect(result.current.groups).toEqual([
        { key: 'all', label: 'All', count: 3 },
        { key: 'gitlab', label: 'GitLab', count: 1, logoUrl: 'gl.png' },
        { key: 'github', label: 'GitHub', count: 2, logoUrl: 'gh.png' },
      ]);
    });

    it('virtual: renders predicate groups after All, before key groups; hides empty', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, virtualConfig),
        { wrapper: wrapper(['/']) },
      );
      // All, then virtual `starred` (count 2), then non-empty categories.
      // `archived` (predicate never true) is hidden.
      expect(result.current.groups).toEqual([
        { key: 'all', label: 'All', count: 3 },
        { key: 'starred', label: 'Starred', count: 2, logoUrl: undefined },
        { key: 'github', label: 'GitHub', count: 2, logoUrl: 'gh.png' },
        { key: 'gitlab', label: 'GitLab', count: 1, logoUrl: 'gl.png' },
      ]);
    });

    it('virtual: filters rows by the predicate, overlapping key groups', () => {
      // starred = rows 1 (github) & 3 (gitlab) — cuts across both categories.
      const { result } = renderHook(
        () => useOverviewState(rows, virtualConfig),
        { wrapper: wrapper(['/?group=starred']) },
      );
      expect(result.current.rows.map(r => r.id)).toEqual(['1', '3']);
    });

    it('propagates allIcon onto All and icon onto virtual groups', () => {
      const AllIcon = () => null;
      const StarIcon = () => null;
      const iconConfig: OverviewConfig<Row> = {
        getId: r => r.id,
        searchFields: r => [r.name],
        group: {
          kind: 'fixed',
          key: r => r.provider,
          label: r => r.provider,
          allIcon: AllIcon,
          keys: [{ key: 'github', label: 'GitHub' }],
          virtual: [
            {
              key: 'starred',
              label: 'Starred',
              predicate: () => true,
              icon: StarIcon,
            },
          ],
        },
      };
      const { result } = renderHook(() => useOverviewState(rows, iconConfig), {
        wrapper: wrapper(['/']),
      });
      const all = result.current.groups.find(g => g.key === 'all');
      const starred = result.current.groups.find(g => g.key === 'starred');
      expect(all?.icon).toBe(AllIcon);
      expect(starred?.icon).toBe(StarIcon);
    });

    it('returns only All when config has no group', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, noGroupConfig),
        { wrapper: wrapper(['/']) },
      );
      expect(result.current.groups).toEqual([
        { key: 'all', label: 'All', count: 3 },
      ]);
    });
  });

  describe('statusCounts', () => {
    it('counts per status + all over search/group-filtered rows', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/']) },
      );
      expect(result.current.statusCounts).toEqual({
        all: 3,
        enabled: 2,
        disabled: 1,
      });
    });

    it('excludes the active status filter but respects group filter', () => {
      // group=github → 2 rows (1 enabled, 1 disabled); status filter ignored
      const { result } = renderHook(
        () => useOverviewState(rows, dynamicConfig),
        { wrapper: wrapper(['/?group=github&status=enabled']) },
      );
      expect(result.current.statusCounts).toEqual({
        all: 2,
        enabled: 1,
        disabled: 1,
      });
    });

    it('is empty when config declares no statuses', () => {
      const { result } = renderHook(
        () => useOverviewState(rows, noGroupConfig),
        { wrapper: wrapper(['/']) },
      );
      expect(result.current.statusCounts).toEqual({});
    });
  });
});

describe('useLegacyTabRedirect', () => {
  function useProbeRedirect() {
    useLegacyTabRedirect();
    const [params] = useSearchParams();
    return params.toString();
  }

  it('rewrites tab→status when status absent', async () => {
    const { result } = renderHook(() => useProbeRedirect(), {
      wrapper: wrapper(['/?tab=enabled']),
    });
    await waitFor(() => expect(result.current).toBe('status=enabled'));
  });

  it('drops tab=all with no status', async () => {
    const { result } = renderHook(() => useProbeRedirect(), {
      wrapper: wrapper(['/?tab=all']),
    });
    await waitFor(() => expect(result.current).toBe(''));
  });

  it('preserves other params when rewriting', async () => {
    const { result } = renderHook(() => useProbeRedirect(), {
      wrapper: wrapper(['/?tab=disabled&search=foo']),
    });
    await waitFor(() =>
      expect(new URLSearchParams(result.current).get('status')).toBe(
        'disabled',
      ),
    );
    expect(new URLSearchParams(result.current).get('search')).toBe('foo');
    expect(new URLSearchParams(result.current).has('tab')).toBe(false);
  });

  it('does nothing when status already present', () => {
    const { result } = renderHook(() => useProbeRedirect(), {
      wrapper: wrapper(['/?tab=enabled&status=disabled']),
    });
    // tab is left untouched, status unchanged
    const params = new URLSearchParams(result.current);
    expect(params.get('status')).toBe('disabled');
    expect(params.get('tab')).toBe('enabled');
  });

  it('does nothing when no tab present', () => {
    const { result } = renderHook(() => useProbeRedirect(), {
      wrapper: wrapper(['/?search=foo']),
    });
    expect(result.current).toBe('search=foo');
  });

  it('rewrites tab=favorites to group=favorites for data sources', async () => {
    const { result } = renderHook(
      () => {
        useLegacyTabRedirect(dataSourceLegacyTabTarget);
        const [params] = useSearchParams();
        return params.toString();
      },
      { wrapper: wrapper(['/?tab=favorites']) },
    );
    await waitFor(() => expect(result.current).toBe('group=favorites'));
  });

  it('drops tab=enabled without setting status for data sources', async () => {
    const { result } = renderHook(
      () => {
        useLegacyTabRedirect(dataSourceLegacyTabTarget);
        const [params] = useSearchParams();
        return params.toString();
      },
      { wrapper: wrapper(['/?tab=enabled']) },
    );
    await waitFor(() => expect(result.current).toBe(''));
  });
});

describe('useDataSourceLegacyStatusRedirect', () => {
  function useProbeStatusRedirect() {
    useDataSourceLegacyStatusRedirect();
    const [params] = useSearchParams();
    return params.toString();
  }

  it('rewrites status=failed to filter.run=result:failed', async () => {
    const { result } = renderHook(() => useProbeStatusRedirect(), {
      wrapper: wrapper(['/?status=failed']),
    });
    await waitFor(() =>
      expect(result.current).toBe('filter.run=result%3Afailed'),
    );
  });

  it('drops status=failed when a run filter is already present', async () => {
    const { result } = renderHook(() => useProbeStatusRedirect(), {
      wrapper: wrapper(['/?status=failed&filter.run=time%3A24h']),
    });
    await waitFor(() => expect(result.current).toBe('filter.run=time%3A24h'));
  });

  it('does nothing for other status values', () => {
    const { result } = renderHook(() => useProbeStatusRedirect(), {
      wrapper: wrapper(['/?status=ready']),
    });
    expect(result.current).toBe('status=ready');
  });

  it('rewrites legacy status=needs-setup to any-setup', async () => {
    const { result } = renderHook(() => useProbeStatusRedirect(), {
      wrapper: wrapper(['/?status=needs-setup']),
    });
    await waitFor(() => expect(result.current).toBe('status=any-setup'));
  });
});
