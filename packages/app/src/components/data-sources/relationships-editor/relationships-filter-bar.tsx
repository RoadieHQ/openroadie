import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import { DataSourceFacetFilter } from './data-source-facet-filter';
import {
  RelationshipFacetFilter,
  type RelationshipFacetValue,
} from './relationship-facet-filter';

interface RelationshipsFilterBarProps {
  /** Enabled data sources available to scope to. */
  dataSources: DataSourceItem[];
  rules: RelationshipRule[];
  scopedDataSourceIds: string[];
  relationshipTypes: string[];
  relationshipRuleIds: string[];
  onScopedDataSourceIdsChange: (ids: string[]) => void;
  onRelationshipsChange: (next: RelationshipFacetValue) => void;
  onClearFilters: () => void;
}

// Header filter bar for the relationships editor: a data-source facet and a
// relationship facet, both backed by URL params so the current scope is
// shareable.
export function RelationshipsFilterBar({
  dataSources,
  rules,
  scopedDataSourceIds,
  relationshipTypes,
  relationshipRuleIds,
  onScopedDataSourceIdsChange,
  onRelationshipsChange,
  onClearFilters,
}: RelationshipsFilterBarProps) {
  const datasourceLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const ds of dataSources) {
      map.set(ds.id, ds.name);
    }
    return map;
  }, [dataSources]);

  const activeCount =
    scopedDataSourceIds.length +
    relationshipTypes.length +
    relationshipRuleIds.length;

  return (
    <div
      className="flex items-center gap-2"
      data-testid="relationships-filter-bar"
    >
      {/* Clear sits before the facets (right after the mode pill) so showing it
          on the first selection shifts the pills, not the filters the user is
          interacting with. */}
      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          data-testid="clear-relationship-filters"
        >
          <X className="size-icon" />
          Clear ({activeCount})
        </Button>
      )}
      <DataSourceFacetFilter
        dataSources={dataSources}
        value={scopedDataSourceIds}
        onChange={onScopedDataSourceIdsChange}
        className="w-56"
      />
      <RelationshipFacetFilter
        rules={rules}
        datasourceLabels={datasourceLabels}
        selectedTypes={relationshipTypes}
        selectedRuleIds={relationshipRuleIds}
        onChange={onRelationshipsChange}
        className="w-56"
      />
    </div>
  );
}
