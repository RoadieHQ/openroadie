import { useMemo } from 'react';
import {
  Sparkles,
  MoreHorizontal,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
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
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import type { ColumnConfig } from '../../overview';
import {
  formatUpdated,
  relativeDateColumnFilter,
  OverviewTitleCell,
} from '../../overview';
import type { Capability } from '../../../api';
import { capabilityDetail } from '../../../config/paths';
import { CAPABILITIES_COLUMN_WIDTH } from './capabilities-table-layout';
import {
  type ParsedReference,
  REFERENCE_TYPE_LABELS,
} from '../editor/references';

/**
 * Warning shown next to a capability whose instructions reference resources
 * that no longer exist (e.g. a deleted data source or action). Surfaces the
 * dangling references so they can be fixed before the capability is run.
 */
export function BrokenReferenceBadge({
  broken,
}: {
  broken: ParsedReference[];
}): JSX.Element {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="shrink-0 text-warning"
            aria-label={`${broken.length} missing reference${
              broken.length === 1 ? '' : 's'
            }`}
            data-testid="capability-broken-references"
          >
            <AlertTriangle className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">
            {broken.length === 1
              ? 'Missing reference'
              : `${broken.length} missing references`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {broken.map(ref => (
              <li key={`${ref.type}:${ref.slug}`}>
                {REFERENCE_TYPE_LABELS[ref.type]}: {ref.slug}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Column definitions for the Capabilities overview table: Name (links to the
 * editor), Version (the current version number), and Updated. Trailing per-row
 * actions live in {@link CapabilityRowActionsMenu} and are supplied via
 * `OverviewTable`'s `rowActions` slot.
 */
export function useCapabilityColumns(
  getBrokenReferences?: (capability: Capability) => ParsedReference[],
): ColumnConfig<Capability>[] {
  return useMemo<ColumnConfig<Capability>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortable: true,
        accessor: c => c.name,
        width: CAPABILITIES_COLUMN_WIDTH.name,
        headClassName: 'pl-4 sm:pl-5',
        cellClassName: 'pl-4 sm:pl-5',
        cell: c => {
          const broken = getBrokenReferences?.(c) ?? [];
          return (
            <div className="flex min-w-0 items-center gap-2">
              <span
                data-testid={`capability-name-${c.id}`}
                className="flex min-w-0 items-center gap-3 font-medium text-foreground"
              >
                <IntegrationIconFrame size="group">
                  <Sparkles className="size-4 shrink-0 text-primary" />
                </IntegrationIconFrame>
                <OverviewTitleCell to={capabilityDetail(c.id)}>
                  {c.name}
                </OverviewTitleCell>
              </span>
              {broken.length > 0 && <BrokenReferenceBadge broken={broken} />}
            </div>
          );
        },
      },
      {
        id: 'version',
        header: 'Version',
        sortable: true,
        accessor: c => c.currentVersion,
        width: CAPABILITIES_COLUMN_WIDTH.version,
        cell: c => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            v{c.currentVersion}
          </span>
        ),
      },
      {
        id: 'updated',
        header: 'Updated',
        sortable: true,
        width: CAPABILITIES_COLUMN_WIDTH.updated,
        accessor: c => c.updatedAt,
        filter: relativeDateColumnFilter('Updated', c => c.updatedAt),
        sortingFn: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
        cell: c => {
          const formatted = formatUpdated(c.updatedAt);
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
    [getBrokenReferences],
  );
}

export interface CapabilityRowActionsMenuProps {
  capability: Capability;
  onEdit: (id: string) => void;
  /** Takes the whole capability — the delete dialog needs its slug to look up
   *  which other capabilities `@capability:`-reference it. */
  onDelete: (capability: Capability) => void;
}

/**
 * Trailing per-row actions (⋯) menu — Edit + Delete. Rendered via
 * `OverviewTable`'s `rowActions` slot, mirroring `IntegrationRowActionsMenu`.
 */
export function CapabilityRowActionsMenu({
  capability,
  onEdit,
  onDelete,
}: CapabilityRowActionsMenuProps): JSX.Element {
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
        <DropdownMenuItem onSelect={() => onEdit(capability.id)}>
          <Pencil />
          <span>Edit</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
          onSelect={() => onDelete(capability)}
        >
          <Trash2 />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
