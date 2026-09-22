import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { FacetList } from '../common/facet-list';
import type { PickerComboboxGroup } from '../common/picker-combobox';
import {
  compoundTableFilterValue,
  type TableFilterConfig,
} from './overview-config';

/** At or above this many options a filter facet shows its search box. */
const SEARCH_THRESHOLD = 8;

interface ColumnFilterFacetProps<T> {
  filter: TableFilterConfig<T>;
  /** Current filter values (from `column.getFilterValue()`). */
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Renders any column {@link TableFilterConfig} as the shared {@link FacetList},
 * so column-header filters use the same searchable checkbox surface as the
 * relationships-editor header facets. Single-select kinds (single enum, boolean,
 * range buckets) replace on pick; multi-select kinds (multi enum, compound
 * sections) toggle. Hosted inline in the column header's popover.
 */
export function ColumnFilterFacet<T>({
  filter,
  selected,
  onChange,
}: ColumnFilterFacetProps<T>): JSX.Element {
  const { groups, multiple } = useMemo(() => {
    switch (filter.kind) {
      case 'enum':
        return {
          multiple: filter.multiple === true,
          groups: [
            {
              options: filter.options.map(option => ({
                id: option.value,
                label: option.label,
                icon: option.icon,
              })),
            },
          ] satisfies PickerComboboxGroup[],
        };
      case 'boolean':
        return {
          multiple: false,
          groups: [
            {
              options: [
                { id: 'true', label: filter.trueLabel },
                { id: 'false', label: filter.falseLabel },
              ],
            },
          ] satisfies PickerComboboxGroup[],
        };
      case 'range':
        return {
          multiple: false,
          groups: [
            {
              options: filter.options.map(option => ({
                id: option.value,
                label: option.label,
              })),
            },
          ] satisfies PickerComboboxGroup[],
        };
      case 'compound':
        return {
          multiple: true,
          groups: filter.sections.map(section => ({
            label: section.label,
            options: section.options.map(option => ({
              id: compoundTableFilterValue(section.id, option.value),
              label: option.label,
              icon: option.icon,
            })),
          })) satisfies PickerComboboxGroup[],
        };
    }
  }, [filter]);

  const optionCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.options.length, 0),
    [groups],
  );

  const handleToggle = (id: string) => {
    if (multiple) {
      onChange(
        selected.includes(id)
          ? selected.filter(value => value !== id)
          : [...selected, id],
      );
      return;
    }
    // Single-select: a second click on the active value clears the filter.
    onChange(selected.includes(id) ? [] : [id]);
  };

  return (
    <div className="flex flex-col">
      <FacetList
        groups={groups}
        selectedIds={selected}
        onToggle={handleToggle}
        placeholder={`Filter ${filter.label.toLowerCase()}…`}
        ariaLabel={`Filter ${filter.label}`}
        showSearch={optionCount >= SEARCH_THRESHOLD}
        autoFocusSearch={optionCount >= SEARCH_THRESHOLD}
      />
      {selected.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([])}
          className="mt-1 h-auto justify-start gap-2 border-t border-border py-1.5 font-normal text-muted-foreground"
        >
          <X className="size-4" />
          Clear {filter.label} filter
        </Button>
      )}
    </div>
  );
}
