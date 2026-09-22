import { useMemo } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  Database,
  History,
  MoreHorizontal,
  Play,
  Power,
  Star,
  Trash2,
} from 'lucide-react';
import humanizeDuration from 'humanize-duration';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { Skeleton } from '@roadiehq/ui/skeleton';
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
import {
  StatusDot,
  type StatusIndicatorTone,
} from '@roadiehq/ui/status-indicator';
import { cn } from '@roadiehq/ui/utils';
import {
  EXECUTION,
  OverviewStatusCell,
  OverviewTitleCell,
  relativeDateColumnFilter,
  statusColumnFilter,
  statusValue,
  toExecutionOutcome,
} from '../../overview';
import type {
  ColumnConfig,
  EnumTableFilterOption,
  StatusDef,
} from '../../overview';
import { dataSourceDetail, dataSourceObjects } from '../../../config/paths';
import type { DataSourceItem } from '../types';
import { getDataSourceToggleActionLabel } from '../data-source-status';
import {
  dataSourceIntegrations,
  getDataSourceActionAvailability,
} from '../readiness';
import type { SetupBadgeInfo } from './data-source-overview';
import { DATA_SOURCES_COLUMN_WIDTH } from './data-sources-table-layout';
import { largePayloadWarningMessage } from '../large-payload-warning';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';

/** Filter facet value for a data source that references no integration. */
const NO_INTEGRATION_FILTER_VALUE = '__none__';

/** Enum-filter values a data source matches (integration ids, or "none"). */
function integrationFilterValues(ds: DataSourceItem): string[] {
  const list = dataSourceIntegrations(ds);
  if (list.length === 0) return [NO_INTEGRATION_FILTER_VALUE];
  return list.map(integration => integration.id ?? NO_INTEGRATION_FILTER_VALUE);
}

/** Keep variant borders/text; strip chip fill in the table status column. */
const DATA_SOURCES_TABLE_STATUS_BADGE_CLASSNAME =
  'bg-transparent whitespace-nowrap shadow-none dark:bg-transparent border-transparent pl-1';

/** A framed logo for a data source / integration, falling back to a database icon. */
function IntegrationGlyph({ logoUrl }: { logoUrl?: string }): JSX.Element {
  return (
    <IntegrationIconFrame size="group">
      {logoUrl ? (
        <IntegrationLogo src={logoUrl} size={16} />
      ) : (
        <Database className="size-4 shrink-0 text-muted-foreground" />
      )}
    </IntegrationIconFrame>
  );
}

function formatLastRun(lastRunAt?: string): string | null {
  if (!lastRunAt) return null;
  const ms = Date.now() - new Date(lastRunAt).getTime();
  return humanizeDuration(ms, { largest: 1, round: true });
}

function dataSourceStatusSortKey(label: string): number {
  switch (label) {
    case 'Enabled':
      return 0;
    case 'Disabled':
      return 1;
    case 'Needs setup':
      return 2;
    case 'Needs integration setup':
      return 3;
    default:
      return 4;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function runTimestamp(ds: DataSourceItem): number | undefined {
  const raw = ds.execution?.isDryRun ? undefined : ds.execution?.lastRunAt;
  if (!raw) return undefined;
  const timestamp = new Date(raw).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

/** The run outcome for filtering — same classification the Run cell renders. */
function runOutcome(ds: DataSourceItem) {
  const execution = ds.execution?.isDryRun ? undefined : ds.execution;
  return toExecutionOutcome({
    status: execution?.status,
    objectCount: execution?.objectCount,
    lastRunAt: execution?.lastRunAt,
  });
}

export interface UseDataSourceColumnsParams {
  executionsLoading?: boolean;
  getSetupBadge: (ds: DataSourceItem) => SetupBadgeInfo;
  onEditIntegration: (integrationId: string) => void;
  getNextRunTooltipLabel: (id: string) => string;
  loadNextRunForDataSource: (id: string) => void;
  favoriteIds: ReadonlySet<string>;
  onToggleFavorite: (id: string) => void;
  onOpenRunDetails: (id: string) => void;
  setupStatuses: ReadonlyArray<StatusDef<DataSourceItem>>;
  integrationFilterOptions: ReadonlyArray<EnumTableFilterOption>;
}

/**
 * Column definitions for the Data Sources overview table. Extracted verbatim
 * from the previous bespoke TanStack table so cell rendering, sorting, and
 * tooltips are preserved 1:1. The select checkbox column is supplied by
 * `OverviewTable`'s `selection` prop; the favourite state indicator stays in
 * the name column. Trailing per-row actions live in {@link DataSourceRowActionsMenu}.
 */
export function useDataSourceColumns({
  executionsLoading,
  getSetupBadge,
  onEditIntegration,
  getNextRunTooltipLabel,
  loadNextRunForDataSource,
  favoriteIds,
  onToggleFavorite,
  onOpenRunDetails,
  setupStatuses,
  integrationFilterOptions,
}: UseDataSourceColumnsParams): ColumnConfig<DataSourceItem>[] {
  return useMemo<ColumnConfig<DataSourceItem>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        enableHiding: false,
        sortable: true,
        accessor: ds => ds.name,
        width: DATA_SOURCES_COLUMN_WIDTH.name,
        cellClassName: 'pl-2 sm:pl-3',
        cell: ds => {
          const favorited = favoriteIds.has(ds.id);
          return (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="flex min-w-0 items-center gap-2 font-medium text-foreground sm:gap-3">
                <IntegrationGlyph logoUrl={ds.logoUrl} />
                <OverviewTitleCell to={dataSourceDetail(ds.id)}>
                  {ds.name}
                </OverviewTitleCell>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'group/star motion-all size-5 min-h-6 min-w-6 shrink-0 active:scale-[0.96] sm:min-h-5 sm:min-w-5',
                  favorited ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
                aria-label={`${favorited ? 'Unstar' : 'Star'} ${ds.name}`}
                onClick={event => {
                  event.stopPropagation();
                  event.preventDefault();
                  onToggleFavorite(ds.id);
                }}
                onPointerDown={event => {
                  event.stopPropagation();
                  event.preventDefault();
                }}
              >
                <Star
                  className={cn(
                    'motion-colors size-4',
                    favorited
                      ? 'fill-current text-warning'
                      : 'text-muted-foreground group-hover/star:text-warning',
                  )}
                />
              </Button>
            </div>
          );
        },
      },
      {
        id: 'integration',
        header: 'Integrations',
        enableHiding: true,
        sortable: true,
        accessor: ds => ds.integration?.label ?? 'No integration',
        filter: {
          kind: 'enum',
          label: 'Integrations',
          // A data source matches if any of its integrations (primary or a
          // chained source) is selected.
          matches: (ds, selected) =>
            integrationFilterValues(ds).some(value => selected.includes(value)),
          options: integrationFilterOptions,
          multiple: true,
        },
        width: DATA_SOURCES_COLUMN_WIDTH.integration,
        cell: ds => {
          const list = dataSourceIntegrations(ds);

          // More than one integration (chained sources): show a count with the
          // full list of integration labels in a tooltip.
          if (list.length > 1) {
            return (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outlineMuted"
                      className={cn(
                        DATA_SOURCES_TABLE_STATUS_BADGE_CLASSNAME,
                        'cursor-default',
                      )}
                    >
                      {list.length} integrations
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="flex flex-col gap-1.5">
                      {list.map((integration, index) => (
                        <span
                          key={integration.id ?? `${integration.type}-${index}`}
                          className="flex items-center gap-2"
                        >
                          <IntegrationGlyph logoUrl={integration.logoUrl} />
                          <span>{integration.label}</span>
                        </span>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          }

          const integration = list[0];
          const integrationId = integration?.id;
          const label = integration?.label ?? 'None';

          if (integrationId) {
            return (
              <Button
                type="button"
                variant="ghost"
                className="h-auto p-0 hover:bg-transparent"
                aria-label={`Edit ${label} integration`}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  onEditIntegration(integrationId);
                }}
              >
                <Badge
                  variant="outlineMuted"
                  interactive
                  className={DATA_SOURCES_TABLE_STATUS_BADGE_CLASSNAME}
                >
                  {label}
                </Badge>
              </Button>
            );
          }

          return (
            <Badge
              variant="outlineMuted"
              className={cn(
                DATA_SOURCES_TABLE_STATUS_BADGE_CLASSNAME,
                'cursor-default',
              )}
            >
              {label}
            </Badge>
          );
        },
      },
      {
        id: 'setup',
        header: 'Status',
        enableHiding: true,
        sortable: true,
        align: 'center',
        width: DATA_SOURCES_COLUMN_WIDTH.setup,
        accessor: ds => getSetupBadge(ds).label,
        filter: statusColumnFilter(setupStatuses, 'Status'),
        sortingFn: (a, b) => {
          const primary =
            dataSourceStatusSortKey(getSetupBadge(a).label) -
            dataSourceStatusSortKey(getSetupBadge(b).label);
          if (primary !== 0) {
            return primary;
          }
          return a.name.localeCompare(b.name, undefined, {
            numeric: true,
          });
        },
        cell: ds => {
          const setup = getSetupBadge(ds);

          if (setup.pending) {
            return <Skeleton className="h-4 w-16 rounded sm:h-5" />;
          }

          return (
            <div className="flex flex-wrap items-center gap-1 py-px">
              <OverviewStatusCell
                fill
                tone={setup.tone}
                label={setup.label}
                tooltip={setup.tooltip}
                onClick={setup.onResolve}
              />
            </div>
          );
        },
      },
      {
        id: 'objects',
        header: 'Objects',
        enableHiding: true,
        sortable: true,
        width: DATA_SOURCES_COLUMN_WIDTH.objects,
        align: 'center',
        accessor: ds =>
          ds.objectCount ??
          (ds.execution?.isDryRun ? undefined : ds.execution?.objectCount),
        filter: {
          kind: 'range',
          label: 'Objects',
          value: ds =>
            ds.objectCount ??
            (ds.execution?.isDryRun ? undefined : ds.execution?.objectCount),
          options: [
            { value: 'empty', label: 'Empty', max: 0 },
            { value: '1-100', label: '1–100 objects', min: 1, max: 100 },
            { value: '101+', label: '101+ objects', min: 101 },
            { value: 'unknown', label: 'Unknown', missing: 'only' },
          ],
        },
        cell: ds => {
          const count =
            ds.objectCount ??
            (ds.execution?.isDryRun ? undefined : ds.execution?.objectCount);
          if (count === undefined) {
            if (executionsLoading) {
              return (
                <Skeleton className="inline-block h-4 w-9 rounded sm:h-5 sm:w-11" />
              );
            }
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <Link
              to={dataSourceObjects(ds.id)}
              className="text-muted-foreground tabular-nums hover:text-foreground hover:underline"
            >
              {count.toLocaleString()}
            </Link>
          );
        },
      },
      {
        id: 'run',
        header: 'Run',
        enableHiding: true,
        sortable: true,
        width: DATA_SOURCES_COLUMN_WIDTH.run,
        accessor: ds =>
          ds.execution?.isDryRun ? undefined : ds.execution?.lastRunAt,
        filter: {
          kind: 'compound',
          label: 'Run',
          sections: [
            {
              id: 'time',
              label: 'Time',
              options: [
                {
                  value: '24h',
                  label: 'Last 24 hours',
                  matches: ds => (runTimestamp(ds) ?? 0) >= Date.now() - DAY_MS,
                },
                {
                  value: '7d',
                  label: 'Last 7 days',
                  matches: ds =>
                    (runTimestamp(ds) ?? 0) >= Date.now() - 7 * DAY_MS,
                },
                {
                  value: '30d',
                  label: 'Last 30 days',
                  matches: ds =>
                    (runTimestamp(ds) ?? 0) >= Date.now() - 30 * DAY_MS,
                },
                {
                  value: 'never',
                  label: 'Never',
                  // Only genuinely never-run sources — an in-flight run has no
                  // lastRunAt but reads as "Running…", not "Never".
                  matches: ds => runOutcome(ds) === 'never',
                },
              ],
            },
            {
              id: 'result',
              label: 'Result',
              options: [
                {
                  value: 'succeeded',
                  label: EXECUTION.succeeded.label,
                  matches: ds =>
                    ds.execution?.isDryRun !== true &&
                    ds.execution?.status === 'completed',
                },
                {
                  value: 'failed',
                  label: EXECUTION.failed.label,
                  matches: ds =>
                    ds.execution?.isDryRun !== true &&
                    ds.execution?.status === 'failed',
                },
              ],
            },
          ],
        },
        sortingFn: (a, b) => {
          const av = a.execution?.isDryRun ? undefined : a.execution?.lastRunAt;
          const bv = b.execution?.isDryRun ? undefined : b.execution?.lastRunAt;
          if (!av && !bv) return 0;
          if (!av) return 1;
          if (!bv) return -1;
          return new Date(av).getTime() - new Date(bv).getTime();
        },
        cell: ds => {
          const lastRunAt = ds.execution?.isDryRun
            ? undefined
            : ds.execution?.lastRunAt;
          const lastRun = formatLastRun(lastRunAt);
          const execution = ds.execution?.isDryRun ? undefined : ds.execution;

          const outcome = toExecutionOutcome({
            status: execution?.status,
            objectCount: execution?.objectCount,
            lastRunAt,
          });
          const isRunning = outcome === 'running';

          // A run can be running/pending before a start time is recorded (a
          // scheduled run, or one triggered elsewhere), so handle running before
          // the empty-cell guard — otherwise it would fall through to "—".
          if (!lastRun && !isRunning) {
            if (executionsLoading) {
              return (
                <div className="flex items-center gap-1.5">
                  <Skeleton className="size-3.5 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-[5.5rem] rounded sm:h-[1.125rem]" />
                </div>
              );
            }
            if (ds.enabled) {
              return (
                <TooltipProvider delayDuration={300}>
                  <Tooltip
                    onOpenChange={open => {
                      if (open) loadNextRunForDataSource(ds.id);
                    }}
                  >
                    <TooltipTrigger asChild>
                      <span className="cursor-default text-muted-foreground">
                        —
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {getNextRunTooltipLabel(ds.id)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            }
            return <span className="text-muted-foreground">—</span>;
          }

          const tone: StatusIndicatorTone =
            outcome === 'partial'
              ? 'warning'
              : outcome === 'failed'
                ? 'destructive'
                : isRunning
                  ? 'neutral'
                  : 'success';

          // Show the relative last-run time (same format as Created) once a run
          // has settled; while a run is in flight, the last-run time would be
          // stale/misleading, so show "Running…" with a pulsing dot instead. The
          // dot colour carries the pass/fail signal, details go in the tooltip.
          const content = (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <StatusDot tone={tone} pulse={isRunning} className="size-1.5" />
              <span className="text-sm whitespace-nowrap">
                {isRunning ? 'Running…' : `${lastRun} ago`}
              </span>
              {execution?.largePayloadWarning && (
                <AlertTriangle
                  className="size-3.5 shrink-0 text-warning"
                  aria-label="Large payload warning"
                />
              )}
            </div>
          );

          // Exact last-run timestamp, formatted like the "Next run" tooltip line.
          const statusWord = statusValue(EXECUTION, outcome).label;
          const lastRunExact = lastRunAt
            ? new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(lastRunAt))
            : null;

          return (
            <TooltipProvider delayDuration={300}>
              <Tooltip
                onOpenChange={open => {
                  if (open && ds.enabled) loadNextRunForDataSource(ds.id);
                }}
              >
                <TooltipTrigger asChild>
                  {execution?.executionId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="group/run h-auto rounded-sm p-0 text-left font-normal hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                      aria-label={`View latest run for ${ds.name}`}
                      onClick={event => {
                        event.stopPropagation();
                        onOpenRunDetails(ds.id);
                      }}
                    >
                      {content}
                    </Button>
                  ) : (
                    <span className="cursor-default">{content}</span>
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  <div className="flex flex-col gap-0.5">
                    {ds.enabled ? (
                      <span>{getNextRunTooltipLabel(ds.id)}</span>
                    ) : null}
                    {lastRunExact ? (
                      <span>{`${statusWord}: ${lastRunExact}`}</span>
                    ) : null}
                    {execution?.largePayloadWarning ? (
                      <span className="mt-1 max-w-72 text-warning">
                        {largePayloadWarningMessage(
                          execution.largePayloadWarning,
                        )}
                      </span>
                    ) : null}
                    {execution?.error ? (
                      <span className="mt-1 max-w-72 text-destructive">
                        {formatErrorString(execution.error)}
                      </span>
                    ) : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
      },
      {
        id: 'created',
        header: 'Created',
        enableHiding: true,
        sortable: true,
        width: DATA_SOURCES_COLUMN_WIDTH.created,
        accessor: ds => ds.createdAt,
        filter: relativeDateColumnFilter('Created', ds => ds.createdAt),
        sortingFn: (a, b) => {
          const av = a.createdAt;
          const bv = b.createdAt;
          if (!av && !bv) return 0;
          if (!av) return 1;
          if (!bv) return -1;
          return new Date(av).getTime() - new Date(bv).getTime();
        },
        cell: ds => {
          const createdAt = ds.createdAt;
          if (!createdAt) {
            return <span className="text-muted-foreground">—</span>;
          }
          const ms = Date.now() - new Date(createdAt).getTime();
          return (
            <span
              className="text-sm whitespace-nowrap text-muted-foreground"
              title={new Date(createdAt).toLocaleString()}
            >
              {humanizeDuration(ms, { largest: 1, round: true })} ago
            </span>
          );
        },
      },
    ],
    [
      executionsLoading,
      getSetupBadge,
      onEditIntegration,
      getNextRunTooltipLabel,
      loadNextRunForDataSource,
      favoriteIds,
      onToggleFavorite,
      onOpenRunDetails,
      setupStatuses,
      integrationFilterOptions,
    ],
  );
}

export interface DataSourceRowActionsMenuProps {
  ds: DataSourceItem;
  getReadinessReason: (ds: DataSourceItem) => string | null | undefined;
  runningIds: Set<string>;
  togglingIds: Set<string>;
  isFavorite: boolean;
  onRun: (id: string) => void;
  onOpenRunDetails: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}

/**
 * Trailing per-row actions (⋯) menu — extracted verbatim so the run/enable
 * gating tooltips and readiness behaviour are preserved. Rendered via
 * `OverviewTable`'s `rowActions` slot.
 */
export function DataSourceRowActionsMenu({
  ds,
  getReadinessReason,
  runningIds,
  togglingIds,
  isFavorite,
  onRun,
  onOpenRunDetails,
  onToggleEnabled,
  onToggleFavorite,
  onDelete,
}: DataSourceRowActionsMenuProps): JSX.Element {
  const readinessReason = getReadinessReason(ds);
  const latestRun = ds.execution?.isDryRun ? undefined : ds.execution;
  const isRunning = runningIds.has(ds.id);
  const isToggling = togglingIds.has(ds.id);
  const { canRun, canToggle, runTooltip, toggleTooltip } =
    getDataSourceActionAvailability({
      enabled: ds.enabled,
      readinessReason,
      isRunning,
      isToggling,
    });

  return (
    <TooltipProvider delayDuration={300}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
            aria-label="Actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem
                  disabled={!canRun}
                  onSelect={() => onRun(ds.id)}
                >
                  <Play />
                  <span>{isRunning ? 'Running…' : 'Run'}</span>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            <TooltipContent>{runTooltip}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem
                  disabled={!latestRun?.executionId}
                  onSelect={() => onOpenRunDetails(ds.id)}
                >
                  <History />
                  <span>View latest run</span>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {latestRun?.executionId ? 'Open run details' : 'No runs yet'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem
                  disabled={!canToggle}
                  onSelect={() => onToggleEnabled(ds.id, !ds.enabled)}
                >
                  <Power />
                  <span>{getDataSourceToggleActionLabel(ds.enabled)}</span>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            <TooltipContent>{toggleTooltip}</TooltipContent>
          </Tooltip>
          <DropdownMenuItem onSelect={() => onToggleFavorite(ds.id)}>
            <Star />
            <span>
              {isFavorite ? 'Remove from favourites' : 'Add to favourites'}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => onDelete(ds.id, ds.name)}
          >
            <Trash2 />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
