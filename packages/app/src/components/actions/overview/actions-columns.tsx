import { useMemo } from 'react';
import { Copy, MoreHorizontal, Pencil, Trash2, Zap } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { deriveActionMode } from '@roadiehq/actions-common';
import type { ColumnConfig, StatusDef } from '../../overview';
import {
  formatUpdated,
  LIFECYCLE,
  OverviewStatusCell,
  OverviewTitleCell,
  relativeDateColumnFilter,
  statusColumnFilter,
} from '../../overview';
import type { ActionWithSchema } from '../types';
import { actionDetail } from '../../../config/paths';
import { ACTIONS_COLUMN_WIDTH } from './actions-table-layout';

function effectiveMode(action: ActionWithSchema): 'read' | 'write' {
  return action.effectiveMode ?? action.mode ?? deriveActionMode(action.steps);
}

/**
 * Column definitions for the Actions overview table. The name cell is an
 * icon + linked title + slug: clicking the title navigates to the action, while
 * clicking anywhere else in the row opens the detail drawer (see
 * `.claude/rules/listing-navigation.md`). The HTTP method renders as a badge;
 * a status dot mirrors
 * the Enabled/Disabled filter chips; and the updated date is a sortable column.
 * Trailing per-row actions (Edit / Duplicate / Delete) live in
 * {@link ActionRowActionsMenu} and are supplied via `OverviewTable`'s
 * `rowActions` slot.
 */
export function useActionColumns(
  statuses: ReadonlyArray<StatusDef<ActionWithSchema>>,
): ColumnConfig<ActionWithSchema>[] {
  return useMemo<ColumnConfig<ActionWithSchema>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        enableHiding: false,
        sortable: true,
        accessor: action => action.name,
        width: ACTIONS_COLUMN_WIDTH.name,
        headClassName: 'pl-4 sm:pl-5',
        cellClassName: 'pl-4 sm:pl-5',
        cell: action => (
          <span
            data-testid={`action-name-${action.id}`}
            className="flex min-w-0 items-center gap-3 text-left font-medium text-foreground"
          >
            <IntegrationIconFrame size="group">
              <Zap className="size-4 shrink-0 text-primary" />
            </IntegrationIconFrame>
            <span className="flex min-w-0 flex-col">
              <OverviewTitleCell to={actionDetail(action.id)}>
                {action.name}
              </OverviewTitleCell>
              <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                {action.slug}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: 'steps',
        header: 'Steps',
        enableHiding: true,
        sortable: true,
        accessor: action =>
          action.steps.map(step => step.request.method).join('+'),
        filter: {
          kind: 'boolean',
          label: 'Step count',
          value: action => action.steps.length > 1,
          trueLabel: 'Multiple steps',
          falseLabel: 'Single step',
        },
        width: ACTIONS_COLUMN_WIDTH.steps,
        cell: action => {
          const mode = effectiveMode(action);
          return (
            <span className="flex items-center gap-1.5">
              <Badge variant="secondary" className="font-mono text-[10px]">
                {action.steps.map(step => step.request.method).join('+')}
              </Badge>
              <Badge
                variant={mode === 'read' ? 'successOutline' : 'warningSubtle'}
                className="text-[10px] uppercase"
              >
                {mode}
              </Badge>
            </span>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        enableHiding: true,
        sortable: true,
        align: 'center',
        width: ACTIONS_COLUMN_WIDTH.status,
        accessor: action =>
          action.enabled ? LIFECYCLE.enabled.label : LIFECYCLE.disabled.label,
        filter: statusColumnFilter(statuses),
        cell: action => (
          <OverviewStatusCell
            fill
            tone={
              action.enabled ? LIFECYCLE.enabled.tone : LIFECYCLE.disabled.tone
            }
            label={
              action.enabled
                ? LIFECYCLE.enabled.label
                : LIFECYCLE.disabled.label
            }
          />
        ),
      },
      {
        id: 'updated',
        header: 'Updated',
        enableHiding: true,
        sortable: true,
        width: ACTIONS_COLUMN_WIDTH.updated,
        accessor: action => action.updatedAt,
        filter: relativeDateColumnFilter('Updated', action => action.updatedAt),
        sortingFn: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
        cell: action => {
          const formatted = formatUpdated(action.updatedAt);
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
    [statuses],
  );
}

export interface ActionRowActionsMenuProps {
  action: ActionWithSchema;
  onEdit: (action: ActionWithSchema) => void;
  onDuplicate: (action: ActionWithSchema) => void;
  onDelete: (action: ActionWithSchema) => void;
}

/**
 * Trailing per-row actions (⋯) menu — Edit / Duplicate / Delete. Rendered via
 * `OverviewTable`'s `rowActions` slot.
 */
export function ActionRowActionsMenu({
  action,
  onEdit,
  onDuplicate,
  onDelete,
}: ActionRowActionsMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Actions for ${action.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(action)}>
          <Pencil />
          <span>Edit</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDuplicate(action)}>
          <Copy />
          <span>Duplicate</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
          onSelect={() => onDelete(action)}
        >
          <Trash2 />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
