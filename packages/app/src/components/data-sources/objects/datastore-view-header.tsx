import type { ReactNode } from 'react';
import {
  OverviewListingPageHeader,
  OverviewListingSearchField,
} from '../../common';
import type { DataSourceItem } from '../types';
import {
  DataSourceFacetFilter,
  type ContextGroupRuleFacetItem,
} from '../relationships-editor/data-source-facet-filter';

interface DatastoreViewHeaderProps {
  title: string;
  description: string;
  /** Data sources offered in the scope facet. */
  dataSources: DataSourceItem[];
  /** Context-group rules offered in the scope facet's "Context Groups" group.
   * Omitted on views that can't show group rows (the graph). */
  contextGroupRules?: ContextGroupRuleFacetItem[];
  scopedDataSourceIds: string[];
  onScopeChange: (ids: string[]) => void;
  /** Required when the default object search field renders (no searchSlot). */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchAriaLabel?: string;
  /** Replaces the default object search field (`null` hides it) — the graph
   * page swaps in mode-specific search. */
  searchSlot?: ReactNode;
  /** Page-specific trailing controls (column picker, clear filters). */
  extraToolbar?: ReactNode;
  /** Hides controls that cannot do anything in a first-run empty state. */
  hideToolbar?: boolean;
}

/**
 * The one header for the Datastore views (table and graph): the same title
 * block and the same scope facet + object search in the same position, so
 * switching views doesn't shift the controls.
 */
export function DatastoreViewHeader({
  title,
  description,
  dataSources,
  contextGroupRules,
  scopedDataSourceIds,
  onScopeChange,
  searchValue,
  onSearchChange,
  searchAriaLabel,
  searchSlot,
  extraToolbar,
  hideToolbar = false,
}: DatastoreViewHeaderProps) {
  return (
    <OverviewListingPageHeader
      title={title}
      description={description}
      toolbar={
        hideToolbar ? undefined : (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <DataSourceFacetFilter
              dataSources={dataSources}
              contextGroupRules={contextGroupRules}
              value={scopedDataSourceIds}
              onChange={onScopeChange}
              className="w-52 [&>button]:h-8"
            />
            {searchSlot !== undefined ? (
              searchSlot
            ) : onSearchChange !== undefined ? (
              <OverviewListingSearchField
                value={searchValue ?? ''}
                onValueChange={onSearchChange}
                placeholder="Search objects…"
                ariaLabel={searchAriaLabel ?? 'Search objects'}
                layout="pageHeader"
              />
            ) : null}
            {extraToolbar}
          </div>
        )
      }
    />
  );
}
