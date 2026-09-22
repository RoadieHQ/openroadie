import { createElement } from 'react';
import type * as React from 'react';
import type { SortingState } from '@tanstack/react-table';

/**
 * Shared contract for the config-driven overview system.
 *
 * A page declares an {@link OverviewConfig} describing how its rows are grouped
 * (sidebar sub-items), filtered by status (in-page chips), and searched. The
 * config is consumed by {@link useOverviewState} (URL sync + filtering) and its
 * derived {@link OverviewGroup}s are published to the sidebar via the
 * overview-data context.
 *
 * Column rendering is described separately by {@link ColumnConfig} and consumed
 * by `OverviewTable`.
 */

/** Reserved group key for the always-present "All" sub-item / default landing. */
export const OVERVIEW_ALL_GROUP = 'all';
/** Reserved status value meaning "no status filter applied". */
export const OVERVIEW_ALL_STATUS = 'all';

/**
 * How rows are grouped into sidebar sub-items.
 *
 * `kind: 'dynamic'` groups (e.g. Data Sources by integration) are hidden when
 * empty. `kind: 'fixed'` groups (e.g. Integrations by category) are enumerated
 * from {@link GroupDef.keys} and shown only when non-empty. Either way an `All`
 * group is always synthesised by {@link useOverviewState}.
 */
export interface GroupDef<T> {
  kind: 'dynamic' | 'fixed';
  /** Stable group key for a row — also the `?group=` URL value. */
  key: (row: T) => string;
  /** Human label for a row's group (used for the sidebar sub-item). */
  label: (row: T) => string;
  /** Optional logo/icon URL for the sidebar sub-item. */
  logoUrl?: (row: T) => string | undefined;
  /**
   * For `kind: 'fixed'`: the full ordered set of possible groups. Non-empty
   * ones are shown; empty ones are hidden. Ignored for `kind: 'dynamic'`.
   */
  keys?: ReadonlyArray<{ key: string; label: string; logoUrl?: string }>;
  /**
   * Predicate-based sub-items rendered after `All` and before the key-based
   * groups (e.g. a `Favorites` view that cuts across categories). See
   * {@link VirtualGroupDef}.
   */
  virtual?: ReadonlyArray<VirtualGroupDef<T>>;
  /** Optional icon for the synthesised `All` sub-item. */
  allIcon?: React.ComponentType<{ className?: string }>;
}

/**
 * A "virtual" sidebar sub-item defined by a predicate rather than a partition
 * key. Unlike the `key`/`keys` groups (mutually exclusive buckets), a virtual
 * group overlaps them — e.g. a favourited Data Source belongs to both
 * `favorites` and its integration category. Virtual groups render after `All`
 * and before the key-based groups and, like fixed groups, are hidden when empty
 * unless {@link alwaysShow} is set.
 */
export interface VirtualGroupDef<T> {
  /** Group key and `?group=` URL value (e.g. `favorites`). */
  key: string;
  label: string;
  /** Membership test; may overlap the key-based groups. */
  predicate: (row: T) => boolean;
  /** Optional logo/icon URL for the sidebar sub-item. */
  logoUrl?: string;
  /** Optional icon component (rendered when {@link logoUrl} is absent). */
  icon?: React.ComponentType<{ className?: string }>;
  /** Show even when the count is 0 (default: hidden when empty). */
  alwaysShow?: boolean;
}

/**
 * A status filter rendered as an in-page chip. The reserved
 * {@link OVERVIEW_ALL_STATUS} chip is synthesised automatically and need not be
 * listed here.
 */
export interface StatusDef<T> {
  /** `?status=` URL value. */
  value: string;
  label: string;
  /** Returns true when a row passes this status filter. */
  predicate: (row: T) => boolean;
  icon?: React.ComponentType<{ className?: string }>;
  /** When false, omitted from column filter menus but still honored in URL matching. */
  showInFilter?: boolean;
}

export interface OverviewConfig<T> {
  /** Stable row id (selection, row keys). */
  getId: (row: T) => string;
  /**
   * Fields concatenated (case-insensitively) for the search box. Null/undefined
   * entries are ignored.
   */
  searchFields: (row: T) => Array<string | null | undefined>;
  /** Optional grouping → sidebar sub-items. Omit for flat pages (no children). */
  group?: GroupDef<T>;
  /** Ordered status filters shown as chips. Omit/empty → no chips. */
  statuses?: StatusDef<T>[];
}

/** A single group/sub-item derived from the active page's data. */
export interface OverviewGroup {
  /** {@link OVERVIEW_ALL_GROUP} or a group key. */
  key: string;
  label: string;
  count: number;
  logoUrl?: string;
  /** Optional icon component, rendered when {@link logoUrl} is absent. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Full href for the sidebar link, filled in by the publishing page. */
  href?: string;
}

/**
 * Snapshot a page publishes to the overview-data context so the sidebar can
 * render its sub-items with counts. Scoped by {@link routeKey} so a page's
 * groups only appear under its own nav item.
 */
export interface OverviewGroupsSnapshot {
  /** The page's top-level route path, e.g. `/data-sources`. */
  routeKey: string;
  groups: OverviewGroup[];
  /** Current `?group=` value ({@link OVERVIEW_ALL_GROUP} default). */
  activeGroup: string;
}

export interface EnumTableFilterOption {
  value: string;
  label: string;
  /** Optional visual shown before the option label. */
  icon?: React.ReactNode;
}

interface EnumTableFilterConfigBase {
  kind: 'enum';
  label: string;
  options: ReadonlyArray<EnumTableFilterOption>;
  multiple?: boolean;
  /** Override the default repeatable `filter.<columnId>` URL parameter. */
  urlParam?: string;
}

export type EnumTableFilterConfig<T> = EnumTableFilterConfigBase &
  (
    | {
        value: (row: T) => string;
        matches?: never;
      }
    | {
        value?: never;
        matches: (row: T, selected: ReadonlyArray<string>) => boolean;
      }
  );

export interface BooleanTableFilterConfig<T> {
  kind: 'boolean';
  label: string;
  value: (row: T) => boolean;
  trueLabel: string;
  falseLabel: string;
  /** Override the default repeatable `filter.<columnId>` URL parameter. */
  urlParam?: string;
}

export interface RangeTableFilterOption {
  value: string;
  label: string;
  min?: number | (() => number);
  max?: number | (() => number);
  /** `only` selects missing values; `include` combines them with the range. */
  missing?: 'include' | 'only';
}

export interface RangeTableFilterConfig<T> {
  kind: 'range';
  label: string;
  value: (row: T) => number | undefined;
  options: ReadonlyArray<RangeTableFilterOption>;
  urlParam?: string;
}

export interface CompoundTableFilterOption<T> extends EnumTableFilterOption {
  matches: (row: T) => boolean;
}

export interface CompoundTableFilterSection<T> {
  id: string;
  label: string;
  options: ReadonlyArray<CompoundTableFilterOption<T>>;
  /** Allow several options from this section. Options are ORed together. */
  multiple?: boolean;
}

/**
 * Several independent facets presented in one column menu. Selections within
 * a section are ORed; active sections are ANDed with each other.
 */
export interface CompoundTableFilterConfig<T> {
  kind: 'compound';
  label: string;
  sections: ReadonlyArray<CompoundTableFilterSection<T>>;
  urlParam?: string;
}

export function compoundTableFilterValue(
  sectionId: string,
  optionValue: string,
): string {
  return `${sectionId}:${optionValue}`;
}

export type TableFilterConfig<T> =
  | EnumTableFilterConfig<T>
  | BooleanTableFilterConfig<T>
  | RangeTableFilterConfig<T>
  | CompoundTableFilterConfig<T>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Standard relative-date presets used by overview timestamp columns. */
export function relativeDateColumnFilter<T>(
  label: string,
  value: (row: T) => string | undefined,
): RangeTableFilterConfig<T> {
  return {
    kind: 'range',
    label,
    value: row => {
      const raw = value(row);
      if (!raw) return undefined;
      const timestamp = new Date(raw).getTime();
      return Number.isNaN(timestamp) ? undefined : timestamp;
    },
    options: [
      {
        value: '24h',
        label: 'Last 24 hours',
        min: () => Date.now() - DAY_MS,
      },
      {
        value: '7d',
        label: 'Last 7 days',
        min: () => Date.now() - 7 * DAY_MS,
      },
      {
        value: '30d',
        label: 'Last 30 days',
        min: () => Date.now() - 30 * DAY_MS,
      },
      { value: 'never', label: 'Never', missing: 'only' },
    ],
  };
}

/**
 * Adapt overview status definitions to the table's enum facet contract. The
 * toolbar and column menu intentionally share the existing `?status=` URL
 * parameter and predicates.
 */
export function statusColumnFilter<T>(
  statuses: ReadonlyArray<StatusDef<T>>,
  label = 'Status',
): EnumTableFilterConfig<T> {
  return {
    kind: 'enum',
    label,
    urlParam: 'status',
    options: statuses
      .filter(status => status.showInFilter !== false)
      .map(({ value, label, icon }) => ({
        value,
        label,
        // Surface the status's glyph in the facet, matching enum facets that
        // carry hand-authored icons. `StatusDef.icon` is a component.
        icon: icon
          ? createElement(icon, { className: 'size-4 text-muted-foreground' })
          : undefined,
      })),
    matches: (row, selected) =>
      selected.some(value =>
        statuses.some(
          status => status.value === value && status.predicate(row),
        ),
      ),
  };
}

/**
 * App-level column description compiled to a TanStack `ColumnDef<T>` by
 * `toColumnDef`. The `cell` escape hatch (arbitrary ReactNode) and custom
 * `sortingFn` preserve rich cells (status badges, tooltips, async values).
 */
export interface ColumnConfig<T> {
  id: string;
  /** Plain-text name used by filter and column-display controls. */
  label?: string;
  /** Header content; a function receives the current sort direction. */
  header:
    | React.ReactNode
    | ((ctx: { sorted: false | 'asc' | 'desc' }) => React.ReactNode);
  /** Value used for default sorting/comparison when `sortingFn` is absent. */
  accessor?: (row: T) => unknown;
  cell: (row: T) => React.ReactNode;
  /** When true, the header renders a sort toggle button. Default false. */
  sortable?: boolean;
  /** Optional domain filter definition. Omitted columns are not filterable. */
  filter?: TableFilterConfig<T>;
  /** Whether global table search should inspect this column. Default false. */
  searchable?: boolean;
  /** Whether users may hide this column. Opt-in; default false. */
  enableHiding?: boolean;
  /** Initial visibility before a user preference overrides it. Default true. */
  defaultVisible?: boolean;
  /** Custom comparator over row originals (takes precedence over `accessor`). */
  sortingFn?: (a: T, b: T) => number;
  /** Width utility class applied to both `<th>` and `<td>` (e.g. `w-[26%]`). */
  width?: string;
  headClassName?: string;
  cellClassName?: string;
  align?: 'left' | 'center' | 'right';
}

export type { SortingState };
