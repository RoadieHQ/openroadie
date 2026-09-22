import { useMemo } from 'react';
import { Waypoints } from 'lucide-react';
import {
  PickerCombobox,
  type PickerComboboxGroup,
} from '../../common/picker-combobox';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { humanizeRelationshipTypeLabel } from '../humanize-relationship-type';

export interface RelationshipFacetValue {
  types: string[];
  ruleIds: string[];
}

interface RelationshipFacetFilterProps {
  /** All relationship rules; only active ones are offered. */
  rules: RelationshipRule[];
  /** id → display name for rendering rule endpoints. */
  datasourceLabels: Map<string, string>;
  selectedTypes: string[];
  selectedRuleIds: string[];
  onChange: (next: RelationshipFacetValue) => void;
  className?: string;
}

const TYPE_PREFIX = 'type:';

function toggle(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter(item => item !== value)
    : [...list, value];
}

// Header facet for filtering graph edges by relationship type and/or individual
// relationship — a thin wrapper over the shared multi-select PickerCombobox.
// Each relationship type is a selectable group heading; its rules are the rows.
export function RelationshipFacetFilter({
  rules,
  datasourceLabels,
  selectedTypes,
  selectedRuleIds,
  onChange,
  className,
}: RelationshipFacetFilterProps) {
  const groups = useMemo<PickerComboboxGroup[]>(() => {
    const label = (id: string) => datasourceLabels.get(id) ?? id;
    const byType = new Map<string, RelationshipRule[]>();
    for (const rule of rules) {
      if (rule.state !== 'active') {
        continue;
      }
      const bucket = byType.get(rule.relationshipType);
      if (bucket) {
        bucket.push(rule);
      } else {
        byType.set(rule.relationshipType, [rule]);
      }
    }
    return Array.from(byType.entries())
      .map(([type, typeRules]) => ({
        id: `${TYPE_PREFIX}${type}`,
        label: humanizeRelationshipTypeLabel(type),
        checked: selectedTypes.includes(type),
        options: typeRules.map(rule => ({
          id: rule.id,
          label: `${label(rule.sourceDatasourceId)} → ${label(rule.targetDatasourceId)}`,
        })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rules, selectedTypes, datasourceLabels]);

  const handleToggle = (id: string) => {
    if (id.startsWith(TYPE_PREFIX)) {
      onChange({
        types: toggle(selectedTypes, id.slice(TYPE_PREFIX.length)),
        ruleIds: selectedRuleIds,
      });
      return;
    }
    onChange({ types: selectedTypes, ruleIds: toggle(selectedRuleIds, id) });
  };

  return (
    <PickerCombobox
      multiple
      groups={groups}
      selectedIds={selectedRuleIds}
      selectedCount={selectedTypes.length + selectedRuleIds.length}
      onToggle={handleToggle}
      onSelect={() => {}}
      triggerIcon={<Waypoints />}
      triggerLabel="Relationships"
      triggerEmptyLabel="All relationships"
      placeholder="Filter relationships…"
      ariaLabel="Filter relationships"
      className={className}
      data-testid="relationship-facet-filter"
    />
  );
}
