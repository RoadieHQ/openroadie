import { useMemo } from 'react';
import { Blocks, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { cn } from '@roadiehq/ui/utils';
import type {
  ColumnConfig,
  EnumTableFilterOption,
  StatusDef,
} from '../../overview';
import {
  OVERVIEW_ALL_GROUP,
  formatUpdated,
  OverviewTitleCell,
  relativeDateColumnFilter,
  statusColumnFilter,
} from '../../overview';
import { integrationDetail } from '../../../config/paths';
import type { IntegrationItem } from '../types';
import { INTEGRATION_TYPE_META } from '../types';
import type { IntegrationSecretSummary } from '../use-integration-secret-status';
import {
  IntegrationReadinessStatus,
  IntegrationSourceBadge,
} from './integration-status-badges';
import {
  INTEGRATIONS_COLUMN_WIDTH,
  INTEGRATIONS_NAME_GUTTER,
} from './integrations-table-layout';

/** Resolve the category meta for an integration type, defaulting to `other`. */
function getTypeMeta(type: string) {
  if (Object.hasOwn(INTEGRATION_TYPE_META, type)) {
    return INTEGRATION_TYPE_META[type as keyof typeof INTEGRATION_TYPE_META];
  }
  return INTEGRATION_TYPE_META.other;
}

export interface UseIntegrationColumnsParams {
  onEdit: (id: string) => void;
  getSecretSummary: (
    item: IntegrationItem,
  ) => IntegrationSecretSummary | undefined;
  secretStatusLoadingForItem: (item: IntegrationItem) => boolean;
  getDeleteDisabledReason: (item: IntegrationItem) => string | null;
  /**
   * Active sidebar group (`?group=`). When a specific category is selected every
   * row shares it, so the Category column is redundant and hidden — it only adds
   * information in the `All` view.
   */
  activeGroup?: string;
  statuses: ReadonlyArray<StatusDef<IntegrationItem>>;
  categoryFilterOptions: ReadonlyArray<EnumTableFilterOption>;
  /**
   * Render the Name cell as a ghost button that opens the editor on click.
   * The admin embed keeps this (its dialog edit flow is triggered from the
   * name). The standalone page instead links the title to the integration and
   * opens a detail drawer on row click, so it passes `false`.
   */
  nameAsButton?: boolean;
}

/**
 * Column definitions for the Integrations overview table. Extracted from the
 * previous bespoke TanStack table (`integrations-table.tsx`) so cell rendering,
 * sorting, and status badges are preserved 1:1. The select column is not used;
 * trailing per-row actions live in {@link IntegrationRowActionsMenu} and are
 * supplied via `OverviewTable`'s `rowActions` slot.
 */
export function useIntegrationColumns({
  onEdit,
  getSecretSummary,
  secretStatusLoadingForItem,
  getDeleteDisabledReason,
  activeGroup = OVERVIEW_ALL_GROUP,
  statuses,
  categoryFilterOptions,
  nameAsButton = true,
}: UseIntegrationColumnsParams): ColumnConfig<IntegrationItem>[] {
  const showCategory = activeGroup === OVERVIEW_ALL_GROUP;
  return useMemo<ColumnConfig<IntegrationItem>[]>(() => {
    const columns = [
      {
        id: 'name',
        header: 'Name',
        enableHiding: false,
        sortable: true,
        accessor: item => item.name,
        width: INTEGRATIONS_COLUMN_WIDTH.name,
        headClassName: INTEGRATIONS_NAME_GUTTER,
        cellClassName: INTEGRATIONS_NAME_GUTTER,
        cell: item => {
          const logo = (
            <IntegrationIconFrame size="group">
              {item.logoUrl ? (
                <IntegrationLogo src={item.logoUrl} size={16} />
              ) : (
                <Blocks className="size-4 shrink-0 text-muted-foreground" />
              )}
            </IntegrationIconFrame>
          );
          // Standalone: the title links to the integration; clicking elsewhere
          // in the row opens the detail drawer.
          if (!nameAsButton) {
            return (
              <span
                data-testid={`integration-name-${item.id}`}
                className="flex min-w-0 items-center gap-3 font-medium text-foreground"
              >
                {logo}
                <OverviewTitleCell to={integrationDetail(item.id)}>
                  {item.name}
                </OverviewTitleCell>
              </span>
            );
          }
          // Admin embed: a ghost button opens the edit dialog.
          return (
            <Button
              type="button"
              variant="ghost"
              data-testid={`integration-name-${item.id}`}
              onClick={() => onEdit(item.id)}
              className="h-auto max-w-full min-w-0 justify-start gap-3 p-0 font-medium text-foreground hover:bg-transparent hover:underline"
            >
              {logo}
              <span className="truncate">{item.name}</span>
            </Button>
          );
        },
      },
      {
        id: 'category',
        header: 'Category',
        enableHiding: true,
        filter: {
          kind: 'enum',
          label: 'Category',
          value: item =>
            Object.hasOwn(INTEGRATION_TYPE_META, item.type)
              ? item.type
              : 'other',
          options: categoryFilterOptions,
          multiple: true,
        },
        sortable: true,
        accessor: item => getTypeMeta(item.type).label,
        width: INTEGRATIONS_COLUMN_WIDTH.category,
        cell: item => (
          <span className="truncate text-sm text-muted-foreground">
            {getTypeMeta(item.type).label}
          </span>
        ),
      },
      {
        id: 'host',
        header: 'Host',
        enableHiding: true,
        sortable: true,
        accessor: item => item.host,
        filter: {
          kind: 'boolean',
          label: 'Host',
          value: item => Boolean(item.host),
          trueLabel: 'Has host',
          falseLabel: 'No host',
        },
        width: INTEGRATIONS_COLUMN_WIDTH.host,
        cell: item => (
          <span
            className={cn(
              'block truncate text-sm',
              item.host ? 'text-muted-foreground' : 'text-muted-foreground/60',
            )}
          >
            {item.host || '—'}
          </span>
        ),
      },
      {
        id: 'setup',
        header: 'Setup',
        enableHiding: true,
        sortable: true,
        filter: statusColumnFilter(statuses, 'Setup'),
        accessor: item =>
          statuses.find(status => status.predicate(item))?.value ?? '',
        sortingFn: (a, b) => {
          const setupSortKey = (item: IntegrationItem) => {
            const value =
              statuses.find(status => status.predicate(item))?.value ?? '';
            if (value === 'ready') return 0;
            if (value === 'needs-setup') return 1;
            return 2;
          };
          const primary = setupSortKey(a) - setupSortKey(b);
          if (primary !== 0) {
            return primary;
          }
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        },
        width: INTEGRATIONS_COLUMN_WIDTH.setup,
        cell: item => (
          <div className="min-w-0 py-0.5">
            <IntegrationReadinessStatus
              item={item}
              secretSummary={getSecretSummary(item)}
              loading={secretStatusLoadingForItem(item)}
            />
          </div>
        ),
      },
      {
        id: 'source',
        header: 'Source',
        enableHiding: true,
        sortable: true,
        accessor: item =>
          item.createdBy === 'system' ? 'Pre-built' : 'Custom',
        filter: {
          kind: 'enum',
          label: 'Source',
          value: item => (item.createdBy === 'system' ? 'system' : 'custom'),
          options: [
            { value: 'system', label: 'Pre-built' },
            { value: 'custom', label: 'Custom' },
          ],
          multiple: true,
        },
        width: INTEGRATIONS_COLUMN_WIDTH.source,
        cell: item => (
          <IntegrationSourceBadge
            item={item}
            deleteDisabledReason={getDeleteDisabledReason(item)}
          />
        ),
      },
      {
        id: 'updated',
        header: 'Updated',
        enableHiding: true,
        sortable: true,
        width: INTEGRATIONS_COLUMN_WIDTH.updated,
        accessor: item => item.updatedAt,
        filter: relativeDateColumnFilter('Updated', item => item.updatedAt),
        sortingFn: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
        cell: item => {
          const formatted = formatUpdated(item.updatedAt);
          return formatted ? (
            <span className="text-sm whitespace-nowrap text-muted-foreground">
              {formatted}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
    ] satisfies ColumnConfig<IntegrationItem>[];

    return columns.filter(column => showCategory || column.id !== 'category');
  }, [
    onEdit,
    getSecretSummary,
    secretStatusLoadingForItem,
    getDeleteDisabledReason,
    showCategory,
    statuses,
    categoryFilterOptions,
    nameAsButton,
  ]);
}

export interface IntegrationRowActionsMenuProps {
  item: IntegrationItem;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  getDeleteDisabledReason: (item: IntegrationItem) => string | null;
}

/**
 * Trailing per-row actions (⋯) menu — Edit + Delete, with the delete item
 * disabled and tooltip-explained when the integration is referenced by
 * workflows. Extracted verbatim from `integrations-table.tsx`. Rendered via
 * `OverviewTable`'s `rowActions` slot.
 */
export function IntegrationRowActionsMenu({
  item,
  onEdit,
  onDelete,
  getDeleteDisabledReason,
}: IntegrationRowActionsMenuProps): JSX.Element {
  const deleteReason = getDeleteDisabledReason(item);

  return (
    <TooltipProvider delayDuration={300}>
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
          <DropdownMenuItem onSelect={() => onEdit(item.id)}>
            <Pencil />
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {deleteReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <DropdownMenuItem
                    disabled
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <Trash2 />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent>{deleteReason}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuItem
              className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => onDelete(item.id, item.name)}
            >
              <Trash2 />
              <span>Delete</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
