import { useMemo } from 'react';
import { Users, MoreHorizontal, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { cn } from '@roadiehq/ui/utils';
import type { ColumnConfig } from '../../overview';
import {
  formatUpdated,
  relativeDateColumnFilter,
  OverviewTitleCell,
} from '../../overview';
import type { ContextGroupRule } from '../types';
import { contextGroupDetail } from '../../../config/paths';
import {
  ContextGroupReadinessBadge,
  getContextGroupReadinessState,
} from './context-group-readiness-alert';
import { CONTEXT_GROUPS_COLUMN_WIDTH } from './context-groups-table-layout';

function availableDatasourceCount(
  datasources: ContextGroupRule['datasources'],
): number {
  return datasources.filter(datasource => datasource.status?.live).length;
}

function contextGroupCompleteness(
  rule: ContextGroupRule,
): 'complete' | 'incomplete' {
  return getContextGroupReadinessState(rule.datasources) === null
    ? 'complete'
    : 'incomplete';
}

/**
 * Column definitions for the Context Groups overview table. Replaces the
 * previous bespoke `RuleCard` list; cell content (name link, source counts) is
 * preserved. Trailing per-row actions (Materialize / Edit / Delete) live in
 * {@link ContextGroupRowActionsMenu} and are supplied via `OverviewTable`'s
 * `rowActions` slot.
 */
export function useContextGroupColumns(): ColumnConfig<ContextGroupRule>[] {
  return useMemo<ColumnConfig<ContextGroupRule>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        accessor: rule => rule.name,
        width: CONTEXT_GROUPS_COLUMN_WIDTH.name,
        headClassName: 'pl-4 sm:pl-5',
        cellClassName: 'pl-4 sm:pl-5',
        cell: rule => (
          <div
            data-testid={`context-group-name-${rule.id}`}
            className="flex min-w-0 items-center gap-3 text-foreground"
          >
            <IntegrationIconFrame size="group">
              <Users className="size-4 shrink-0 text-primary" />
            </IntegrationIconFrame>
            <OverviewTitleCell to={contextGroupDetail(rule.id)}>
              {rule.name}
            </OverviewTitleCell>
          </div>
        ),
      },
      {
        id: 'dataSources',
        header: 'Data Sources',
        sortable: true,
        accessor: rule => availableDatasourceCount(rule.datasources),
        filter: {
          kind: 'range',
          label: 'Data Sources',
          value: rule => availableDatasourceCount(rule.datasources),
          options: [
            { value: 'empty', label: 'No available data sources', max: 0 },
            {
              value: 'few',
              label: '1–5 available data sources',
              min: 1,
              max: 5,
            },
            { value: 'many', label: '6+ available data sources', min: 6 },
          ],
        },
        width: CONTEXT_GROUPS_COLUMN_WIDTH.dataSources,
        cell: rule => (
          <span className="truncate text-sm text-muted-foreground">
            {availableDatasourceCount(rule.datasources)} available
          </span>
        ),
      },
      {
        id: 'completeness',
        header: 'Completeness',
        sortable: true,
        accessor: rule => contextGroupCompleteness(rule),
        filter: {
          kind: 'enum',
          label: 'Completeness',
          value: rule => contextGroupCompleteness(rule),
          options: [
            { value: 'complete', label: 'Complete' },
            { value: 'incomplete', label: 'Incomplete' },
          ],
        },
        width: CONTEXT_GROUPS_COLUMN_WIDTH.completeness,
        cell: rule => (
          <ContextGroupReadinessBadge datasources={rule.datasources} />
        ),
      },
      {
        id: 'updated',
        header: 'Updated',
        sortable: true,
        width: CONTEXT_GROUPS_COLUMN_WIDTH.updated,
        accessor: rule => rule.updatedAt,
        filter: relativeDateColumnFilter('Updated', rule => rule.updatedAt),
        sortingFn: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
        cell: rule => {
          const formatted = formatUpdated(rule.updatedAt);
          return formatted ? (
            <span className="text-sm whitespace-nowrap text-muted-foreground">
              {formatted}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
    ],
    [],
  );
}

export interface ContextGroupRowActionsMenuProps {
  rule: ContextGroupRule;
  onEdit: (id: string) => void;
  onDelete: (rule: ContextGroupRule) => void;
  onMaterialize: (rule: ContextGroupRule) => void;
  /** Ids of rules currently being materialized (spinner + disabled state). */
  materializingIds?: ReadonlySet<string>;
}

/**
 * Trailing per-row actions (⋯) menu — Materialize / Edit / Delete. Preserves
 * the legacy card behaviour (materialize triggers a refresh with success/error
 * alerts handled by the page). Rendered via `OverviewTable`'s `rowActions` slot.
 */
export function ContextGroupRowActionsMenu({
  rule,
  onEdit,
  onDelete,
  onMaterialize,
  materializingIds,
}: ContextGroupRowActionsMenuProps): JSX.Element {
  const isMaterializing = materializingIds?.has(rule.id) ?? false;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Actions"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={isMaterializing}
          onSelect={() => onMaterialize(rule)}
        >
          <RefreshCw className={cn(isMaterializing && 'motion-icon-spin')} />
          <span>{isMaterializing ? 'Updating...' : 'Update groups'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onEdit(rule.id)}>
          <Pencil />
          <span>Edit</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
          onSelect={() => onDelete(rule)}
        >
          <Trash2 />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
