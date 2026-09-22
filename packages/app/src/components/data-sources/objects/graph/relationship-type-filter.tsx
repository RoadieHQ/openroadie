import { useMemo } from 'react';
import { Waypoints } from 'lucide-react';
import {
  PickerCombobox,
  type PickerComboboxGroup,
} from '../../../common/picker-combobox';
import { humanizeRelationshipTypeLabel } from '../../humanize-relationship-type';

const ALL_GROUP_ID = 'group:all';

// Header facet for filtering graph edges by relationship type name — a thin
// wrapper over the shared multi-select PickerCombobox (one group whose
// heading toggles all types at once).
export function RelationshipTypeFilter({
  types,
  value,
  onChange,
  className,
}: {
  /** Distinct type names available in the current scope. */
  types: string[];
  value: string[];
  onChange: (types: string[]) => void;
  className?: string;
}) {
  const groups = useMemo<PickerComboboxGroup[]>(() => {
    const sorted = [...types].sort((a, b) =>
      humanizeRelationshipTypeLabel(a).localeCompare(
        humanizeRelationshipTypeLabel(b),
      ),
    );
    const selectedCount = sorted.filter(type => value.includes(type)).length;
    return [
      {
        id: ALL_GROUP_ID,
        label: 'Relationship types',
        checked:
          selectedCount === 0
            ? false
            : selectedCount === sorted.length
              ? true
              : ('indeterminate' as const),
        options: sorted.map(type => ({
          id: type,
          label: humanizeRelationshipTypeLabel(type),
        })),
      },
    ];
  }, [types, value]);

  const handleToggle = (id: string) => {
    if (id === ALL_GROUP_ID) {
      onChange(value.length === types.length ? [] : [...types]);
      return;
    }
    onChange(
      value.includes(id) ? value.filter(type => type !== id) : [...value, id],
    );
  };

  return (
    <PickerCombobox
      multiple
      groups={groups}
      selectedIds={value}
      onToggle={handleToggle}
      onSelect={() => {}}
      triggerIcon={<Waypoints />}
      triggerLabel="Types"
      triggerEmptyLabel="All types"
      placeholder="Filter relationship types…"
      ariaLabel="Filter relationship types"
      className={className}
      data-testid="relationship-type-filter"
    />
  );
}
