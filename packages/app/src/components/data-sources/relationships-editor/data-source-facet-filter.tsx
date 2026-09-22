import { useMemo } from 'react';
import { Database, Users } from 'lucide-react';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import {
  PickerCombobox,
  type PickerComboboxGroup,
} from '../../common/picker-combobox';
import type { DataSourceItem } from '../types';
import { contextGroupScopeId } from '../objects/context-group-scope';

export interface ContextGroupRuleFacetItem {
  id: string;
  name: string;
}

interface DataSourceFacetFilterProps {
  /** Enabled data sources that can be scoped to. */
  dataSources: DataSourceItem[];
  /** Context-group rules offered as a top-level "Context Groups" group whose
   * options scope the view to a rule's materialized groups (`cg:<ruleId>` ids).
   * Omitted on views that scope to data sources only (relationships, graph). */
  contextGroupRules?: ContextGroupRuleFacetItem[];
  /** Currently scoped ids. Empty means "all data sources" (no scope). */
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}

const GROUP_PREFIX = 'group:';
const ALL_DATA_SOURCES_OPTION_ID = 'all:data-sources';

// Header facet for scoping the graph to a set of data sources — a thin wrapper
// over the shared multi-select PickerCombobox. Data sources are grouped by
// integration; the group heading is a "select all" checkbox.
export function DataSourceFacetFilter({
  dataSources,
  contextGroupRules,
  value,
  onChange,
  className,
}: DataSourceFacetFilterProps) {
  const selected = useMemo(() => new Set(value), [value]);

  const { groups, idsByGroup } = useMemo(() => {
    const byLabel = new Map<string, DataSourceItem[]>();
    const logoByLabel = new Map<string, string | undefined>();
    for (const ds of dataSources) {
      const label =
        ds.integration?.label ??
        ds.integration?.type ??
        ds.sourceType ??
        'Other';
      const bucket = byLabel.get(label);
      if (bucket) {
        bucket.push(ds);
      } else {
        byLabel.set(label, [ds]);
        logoByLabel.set(label, ds.integration?.logoUrl);
      }
    }
    const memberIds = new Map<string, string[]>();
    const built: PickerComboboxGroup[] = [
      {
        options: [
          {
            id: ALL_DATA_SOURCES_OPTION_ID,
            label: 'All data sources',
            icon: <Database className="size-4 text-muted-foreground" />,
          },
        ],
      },
      ...Array.from(byLabel.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, items]) => {
          const sorted = [...items].sort((a, b) =>
            a.name.localeCompare(b.name),
          );
          const ids = sorted.map(ds => ds.id);
          memberIds.set(`${GROUP_PREFIX}${label}`, ids);
          const selectedInGroup = ids.filter(id => selected.has(id)).length;
          const logoUrl = logoByLabel.get(label);
          return {
            id: `${GROUP_PREFIX}${label}`,
            label,
            checked:
              selectedInGroup === 0
                ? false
                : selectedInGroup === ids.length
                  ? true
                  : ('indeterminate' as const),
            icon: logoUrl ? (
              <IntegrationLogo src={logoUrl} size={16} />
            ) : (
              <Database className="size-4 text-muted-foreground" />
            ),
            options: sorted.map(ds => ({
              id: ds.id,
              label: ds.name,
              icon: <IntegrationLogo src={ds.logoUrl ?? ''} size={16} />,
            })),
          };
        }),
    ];
    // Context groups sit after the integrations, as their own top-level group:
    // the heading selects every rule, each option one rule's materialized
    // groups.
    if (contextGroupRules && contextGroupRules.length > 0) {
      const sortedRules = [...contextGroupRules].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const ids = sortedRules.map(rule => contextGroupScopeId(rule.id));
      const groupId = `${GROUP_PREFIX}Context Groups`;
      memberIds.set(groupId, ids);
      const selectedInGroup = ids.filter(id => selected.has(id)).length;
      built.push({
        id: groupId,
        label: 'Context Groups',
        checked:
          selectedInGroup === 0
            ? false
            : selectedInGroup === ids.length
              ? true
              : ('indeterminate' as const),
        icon: <Users className="size-4 text-muted-foreground" />,
        options: sortedRules.map(rule => ({
          id: contextGroupScopeId(rule.id),
          label: rule.name,
          icon: <Users className="size-4 text-muted-foreground" />,
        })),
      });
    }
    return { groups: built, idsByGroup: memberIds };
  }, [dataSources, contextGroupRules, selected]);

  const handleToggle = (id: string) => {
    if (id === ALL_DATA_SOURCES_OPTION_ID) {
      onChange([]);
      return;
    }
    if (id.startsWith(GROUP_PREFIX)) {
      const ids = idsByGroup.get(id) ?? [];
      const allSelected = ids.every(memberId => selected.has(memberId));
      onChange(
        allSelected
          ? value.filter(v => !ids.includes(v))
          : Array.from(new Set([...value, ...ids])),
      );
      return;
    }
    onChange(selected.has(id) ? value.filter(v => v !== id) : [...value, id]);
  };

  return (
    <PickerCombobox
      multiple
      groups={groups}
      selectedIds={value.length === 0 ? [ALL_DATA_SOURCES_OPTION_ID] : value}
      selectedCount={value.length}
      onToggle={handleToggle}
      onSelect={() => {}}
      triggerIcon={<Database />}
      triggerLabel="Data sources"
      triggerEmptyLabel="All data sources"
      placeholder="Filter data sources…"
      ariaLabel="Filter data sources"
      className={className}
      data-testid="datasource-facet-filter"
    />
  );
}
