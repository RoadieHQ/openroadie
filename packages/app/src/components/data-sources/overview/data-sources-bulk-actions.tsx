import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, Play, Power, Star, Trash2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { toolbarControlButtonClassName } from '@roadiehq/ui/toolbar';
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
import { cn } from '@roadiehq/ui/utils';
import { resolveDataSourceReadinessReason } from '../readiness';
import type { IntegrationSecretSummary } from '../../integrations/use-integration-secret-status';
import type { DataSourceItem } from '../types';

export interface DataSourcesBulkSelectionState {
  selectedCount: number;
  selectedItems: Array<{ id: string; name: string }>;
  runnableIds: string[];
  enableableIds: string[];
  disableableIds: string[];
  bulkRunning: boolean;
  bulkToggling: boolean;
  runDisabledReason?: BulkActionTooltipContent;
  enableDisabledReason?: BulkActionTooltipContent;
  disableDisabledReason?: BulkActionTooltipContent;
  runPartialReason?: BulkActionTooltipContent;
  enablePartialReason?: BulkActionTooltipContent;
  disablePartialReason?: BulkActionTooltipContent;
}

export interface BulkActionTooltipBlock {
  label?: string;
  reason: string;
  count: number;
}

export interface BulkActionTooltipContent {
  summary?: string;
  blocks?: BulkActionTooltipBlock[];
}

type GetReadinessReason = (ds: DataSourceItem) => string | null | undefined;

type BulkActionTooltipBlockInput = {
  label?: string;
  reason: string;
};

function createBlockFromDataSource(
  ds: DataSourceItem,
  reason: string,
): BulkActionTooltipBlockInput {
  const label = ds.integration?.label?.trim();
  return {
    label: label || undefined,
    reason,
  };
}

function aggregateBlocks(
  inputs: BulkActionTooltipBlockInput[],
): BulkActionTooltipBlock[] {
  const grouped = new Map<string, BulkActionTooltipBlock>();

  for (const input of inputs) {
    const key = `${input.label ?? ''}\0${input.reason}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, {
        label: input.label,
        reason: input.reason,
        count: 1,
      });
    }
  }

  return [...grouped.values()].sort((a, b) =>
    `${a.label ?? ''}\0${a.reason}`.localeCompare(
      `${b.label ?? ''}\0${b.reason}`,
    ),
  );
}

function buildTooltipContent(
  summary: string | undefined,
  blockInputs: BulkActionTooltipBlockInput[],
): BulkActionTooltipContent | undefined {
  const blocks = aggregateBlocks(blockInputs);

  if (!summary && blocks.length === 0) {
    return undefined;
  }

  if (blocks.length === 0) {
    return { summary };
  }

  return {
    summary,
    blocks,
  };
}

function getIneligibleBlocks(
  selected: DataSourceItem[],
  eligibleIds: string[],
  getBlocks: (ds: DataSourceItem) => BulkActionTooltipBlockInput[],
): BulkActionTooltipBlockInput[] {
  const eligibleIdSet = new Set(eligibleIds);

  return selected.filter(ds => !eligibleIdSet.has(ds.id)).flatMap(getBlocks);
}

function getBulkPartialReason(
  selectedCount: number,
  eligibleCount: number,
  blockInputs: BulkActionTooltipBlockInput[],
): BulkActionTooltipContent | undefined {
  if (
    selectedCount === 0 ||
    eligibleCount === 0 ||
    eligibleCount >= selectedCount
  ) {
    return undefined;
  }

  const ineligibleCount = selectedCount - eligibleCount;
  return buildTooltipContent(
    `Not possible for ${ineligibleCount} of ${selectedCount} selected`,
    blockInputs,
  );
}

export function getBulkRunDisabledReason(
  selected: DataSourceItem[],
  runnableIds: string[],
  bulkRunning: boolean,
  getReadinessReason: GetReadinessReason,
): BulkActionTooltipContent | undefined {
  if (selected.length === 0) {
    return { summary: 'Select data sources to run' };
  }

  if (runnableIds.length > 0 && !bulkRunning) {
    return undefined;
  }

  if (bulkRunning) {
    return { summary: 'A selected data source is already running' };
  }

  const blockInputs = selected.flatMap(ds => {
    const blocks: BulkActionTooltipBlockInput[] = [];

    if (!ds.enabled) {
      blocks.push({ reason: 'Selected data sources must be enabled to run' });
    }

    const readinessReason = getReadinessReason(ds);
    if (readinessReason) {
      blocks.push(createBlockFromDataSource(ds, readinessReason));
    }

    return blocks;
  });

  return (
    buildTooltipContent(undefined, blockInputs) ?? {
      summary: 'No selected data sources can be run',
    }
  );
}

export function getBulkEnableDisabledReason(
  selected: DataSourceItem[],
  enableableIds: string[],
  bulkToggling: boolean,
  getReadinessReason: GetReadinessReason,
): BulkActionTooltipContent | undefined {
  if (selected.length === 0) {
    return { summary: 'Select data sources to enable' };
  }

  if (enableableIds.length > 0 && !bulkToggling) {
    return undefined;
  }

  if (bulkToggling) {
    return { summary: 'Updating selected data sources…' };
  }

  const disabledSelected = selected.filter(ds => !ds.enabled);
  if (disabledSelected.length === 0) {
    return { summary: 'Selected data sources are already enabled' };
  }

  const blockInputs = disabledSelected.flatMap(ds => {
    const readinessReason = getReadinessReason(ds);
    return readinessReason
      ? [createBlockFromDataSource(ds, readinessReason)]
      : [];
  });

  const content = buildTooltipContent(undefined, blockInputs);
  if (content) {
    return content;
  }

  return { summary: 'No selected data sources can be enabled' };
}

export function getBulkDisableDisabledReason(
  selected: DataSourceItem[],
  disableableIds: string[],
  bulkToggling: boolean,
): BulkActionTooltipContent | undefined {
  if (selected.length === 0) {
    return { summary: 'Select data sources to disable' };
  }

  if (disableableIds.length > 0 && !bulkToggling) {
    return undefined;
  }

  if (bulkToggling) {
    return { summary: 'Updating selected data sources…' };
  }

  if (selected.every(ds => !ds.enabled)) {
    return { summary: 'Selected data sources are already disabled' };
  }

  return { summary: 'No selected data sources can be disabled' };
}

export function getBulkRunPartialReason(
  selected: DataSourceItem[],
  runnableIds: string[],
  getReadinessReason: GetReadinessReason,
  runningIds: Set<string>,
): BulkActionTooltipContent | undefined {
  return getBulkPartialReason(
    selected.length,
    runnableIds.length,
    getIneligibleBlocks(selected, runnableIds, ds => {
      const blocks: BulkActionTooltipBlockInput[] = [];

      if (runningIds.has(ds.id)) {
        blocks.push({ reason: 'Already running' });
      }
      if (!ds.enabled) {
        blocks.push({ reason: 'Must be enabled to run' });
      }

      const readinessReason = getReadinessReason(ds);
      if (readinessReason) {
        blocks.push(createBlockFromDataSource(ds, readinessReason));
      }

      return blocks;
    }),
  );
}

export function getBulkEnablePartialReason(
  selected: DataSourceItem[],
  enableableIds: string[],
  getReadinessReason: GetReadinessReason,
  togglingIds: Set<string>,
): BulkActionTooltipContent | undefined {
  return getBulkPartialReason(
    selected.length,
    enableableIds.length,
    getIneligibleBlocks(selected, enableableIds, ds => {
      if (ds.enabled) {
        return [{ reason: 'Already enabled' }];
      }
      if (togglingIds.has(ds.id)) {
        return [{ reason: 'Updating selected data sources…' }];
      }

      const readinessReason = getReadinessReason(ds);
      if (readinessReason) {
        return [createBlockFromDataSource(ds, readinessReason)];
      }

      return [];
    }),
  );
}

export function getBulkDisablePartialReason(
  selected: DataSourceItem[],
  disableableIds: string[],
  togglingIds: Set<string>,
): BulkActionTooltipContent | undefined {
  return getBulkPartialReason(
    selected.length,
    disableableIds.length,
    getIneligibleBlocks(selected, disableableIds, ds => {
      if (!ds.enabled) {
        return [{ reason: 'Already disabled' }];
      }
      if (togglingIds.has(ds.id)) {
        return [{ reason: 'Updating selected data sources…' }];
      }

      return [];
    }),
  );
}

export function buildBulkSelectionState(
  selected: DataSourceItem[],
  runningIds: Set<string>,
  togglingIds: Set<string>,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading: boolean,
): DataSourcesBulkSelectionState {
  const getReadinessReason = (ds: DataSourceItem) =>
    resolveDataSourceReadinessReason(
      ds,
      summariesByIntegrationId,
      secretStatusLoading,
    );

  const runnable = selected
    .filter(
      ds => ds.enabled && !getReadinessReason(ds) && !runningIds.has(ds.id),
    )
    .map(ds => ds.id);
  const enableable = selected
    .filter(
      ds => !ds.enabled && !getReadinessReason(ds) && !togglingIds.has(ds.id),
    )
    .map(ds => ds.id);
  const disableable = selected
    .filter(ds => ds.enabled && !togglingIds.has(ds.id))
    .map(ds => ds.id);

  const bulkRunning = selected.some(ds => runningIds.has(ds.id));
  const bulkToggling = selected.some(ds => togglingIds.has(ds.id));

  return {
    selectedCount: selected.length,
    selectedItems: selected.map(ds => ({ id: ds.id, name: ds.name })),
    runnableIds: runnable,
    enableableIds: enableable,
    disableableIds: disableable,
    bulkRunning,
    bulkToggling,
    runDisabledReason: getBulkRunDisabledReason(
      selected,
      runnable,
      bulkRunning,
      getReadinessReason,
    ),
    enableDisabledReason: getBulkEnableDisabledReason(
      selected,
      enableable,
      bulkToggling,
      getReadinessReason,
    ),
    disableDisabledReason: getBulkDisableDisabledReason(
      selected,
      disableable,
      bulkToggling,
    ),
    runPartialReason: getBulkRunPartialReason(
      selected,
      runnable,
      getReadinessReason,
      runningIds,
    ),
    enablePartialReason: getBulkEnablePartialReason(
      selected,
      enableable,
      getReadinessReason,
      togglingIds,
    ),
    disablePartialReason: getBulkDisablePartialReason(
      selected,
      disableable,
      togglingIds,
    ),
  };
}

const EMPTY_ID_SET = new Set<string>();
const EMPTY_SUMMARY_MAP = new Map<string, IntegrationSecretSummary>();

function emptyBulkSelectionState(): DataSourcesBulkSelectionState {
  return buildBulkSelectionState(
    [],
    EMPTY_ID_SET,
    EMPTY_ID_SET,
    EMPTY_SUMMARY_MAP,
    false,
  );
}

function actionLabel(label: string, count: number): ReactNode {
  return (
    <>
      <span>{label}</span>
      <span className="ml-auto text-muted-foreground tabular-nums">
        {count}
      </span>
    </>
  );
}

const BULK_ACTION_TOOLTIP_DELAY_MS = 1000;

function useDelayedTooltip(delayMs = BULK_ACTION_TOOLTIP_DELAY_MS) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerEnter = useCallback(() => {
    cancel();
    timerRef.current = setTimeout(() => setOpen(true), delayMs);
  }, [cancel, delayMs]);

  const onPointerLeave = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        cancel();
        setOpen(false);
      }
    },
    [cancel],
  );

  return { open, onOpenChange, onPointerEnter, onPointerLeave };
}

function BulkActionTooltipBody({
  content,
}: {
  content: BulkActionTooltipContent;
}) {
  const hasBlocks = (content.blocks?.length ?? 0) > 0;

  return (
    <div className="space-y-2.5">
      {content.summary ? (
        <p
          className={cn(
            'text-xs leading-snug',
            hasBlocks
              ? 'font-medium text-tooltip-foreground'
              : 'text-tooltip-foreground',
          )}
        >
          {content.summary}
        </p>
      ) : null}

      {hasBlocks ? (
        <ul className="space-y-2 border-t border-border/60 pt-2.5">
          {content.blocks?.map(block => (
            <li
              key={`${block.label ?? ''}-${block.reason}`}
              className="rounded-md border border-border/50 bg-background/50 px-2.5 py-2"
            >
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 text-xs leading-snug font-medium text-tooltip-foreground">
                  {block.label ?? block.reason}
                </p>
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background text-[10px] font-medium text-muted-foreground tabular-nums"
                  aria-label={`${block.count} selected`}
                >
                  {block.count}
                </span>
              </div>
              {block.label ? (
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {block.reason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BulkActionMenuItem({
  disabled = false,
  tooltipContent,
  onSelect,
  children,
  className,
}: {
  disabled?: boolean;
  tooltipContent?: BulkActionTooltipContent;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}) {
  const tooltip = useDelayedTooltip();
  const item = (
    <DropdownMenuItem
      disabled={disabled}
      className={className}
      onSelect={() => {
        onSelect();
      }}
    >
      {children}
    </DropdownMenuItem>
  );

  if (!tooltipContent) {
    return item;
  }

  return (
    <Tooltip open={tooltip.open} onOpenChange={tooltip.onOpenChange}>
      <TooltipTrigger asChild>
        <div
          onPointerEnter={tooltip.onPointerEnter}
          onPointerLeave={tooltip.onPointerLeave}
        >
          {item}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="max-w-sm px-3 py-2.5 text-left"
      >
        <BulkActionTooltipBody content={tooltipContent} />
      </TooltipContent>
    </Tooltip>
  );
}

interface DataSourcesBulkActionsProps {
  state: DataSourcesBulkSelectionState | null;
  onRun: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onAddToFavorites: () => void;
  onRemoveFromFavorites: () => void;
  onDelete: () => void;
}

export function DataSourcesBulkActions({
  state: selectionState,
  onRun,
  onEnable,
  onDisable,
  onAddToFavorites,
  onRemoveFromFavorites,
  onDelete,
}: DataSourcesBulkActionsProps) {
  const state = selectionState ?? emptyBulkSelectionState();
  // Bulk actions only appear once rows are selected; otherwise the inert
  // "0 selected" trigger reads as a redundant twin of the Setup filter beside
  // it. Selecting rows reveals the control with a meaningful "N selected".
  if (state.selectedCount === 0) {
    return null;
  }
  const runDisabled =
    state.selectedCount === 0 ||
    state.runnableIds.length === 0 ||
    state.bulkRunning;
  const enableDisabled =
    state.selectedCount === 0 ||
    state.enableableIds.length === 0 ||
    state.bulkToggling;
  const disableDisabled =
    state.selectedCount === 0 ||
    state.disableableIds.length === 0 ||
    state.bulkToggling;
  const deleteDisabled = state.selectedCount === 0;
  const deleteDisabledReason: BulkActionTooltipContent | undefined =
    state.selectedCount === 0
      ? { summary: 'Select data sources to delete' }
      : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(toolbarControlButtonClassName, 'tabular-nums')}
        >
          {state.selectedCount} selected
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <BulkActionMenuItem
            disabled={runDisabled}
            tooltipContent={
              runDisabled ? state.runDisabledReason : state.runPartialReason
            }
            onSelect={onRun}
          >
            <Play />
            {actionLabel('Run', state.runnableIds.length)}
          </BulkActionMenuItem>
          <BulkActionMenuItem
            disabled={enableDisabled}
            tooltipContent={
              enableDisabled
                ? state.enableDisabledReason
                : state.enablePartialReason
            }
            onSelect={onEnable}
          >
            <Power />
            {actionLabel('Enable', state.enableableIds.length)}
          </BulkActionMenuItem>
          <BulkActionMenuItem
            disabled={disableDisabled}
            tooltipContent={
              disableDisabled
                ? state.disableDisabledReason
                : state.disablePartialReason
            }
            onSelect={onDisable}
          >
            <Power />
            {actionLabel('Disable', state.disableableIds.length)}
          </BulkActionMenuItem>
          <BulkActionMenuItem onSelect={onAddToFavorites}>
            <Star />
            {actionLabel('Add to favourites', state.selectedCount)}
          </BulkActionMenuItem>
          <BulkActionMenuItem onSelect={onRemoveFromFavorites}>
            <Star />
            {actionLabel('Remove from favourites', state.selectedCount)}
          </BulkActionMenuItem>
          <DropdownMenuSeparator />
          <BulkActionMenuItem
            disabled={deleteDisabled}
            tooltipContent={deleteDisabledReason}
            onSelect={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 />
            {actionLabel('Delete', state.selectedCount)}
          </BulkActionMenuItem>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
