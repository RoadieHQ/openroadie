import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { DateTime } from 'luxon';
import { Button } from '@roadiehq/ui/button';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { EmptyState } from '@roadiehq/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import {
  ArrowRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  Laptop,
  RefreshCw,
  ScrollText,
  Terminal,
  Zap,
} from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { useMcpAudit } from '../../api';
import { mcpAuditFacetsQuery } from '../../api/queries';
import { workspaceQueryKey } from '../../api/workspace-scope';
import type { McpAuditFacets } from '../../api/mcp-audit';
import { OverviewListingSearchField } from '../common';
import {
  GhostTablePreview,
  ghostSettleAt,
  OverviewEmptyPreview,
  type GhostRow,
} from '../overview';
import { PATHS } from '../../config/paths';
import { groupByCorrelation } from './helpers';
import { SessionList } from './session-list';
import { SessionDetail } from './session-detail';
import {
  TokenNameProvider,
  useResolveCustomerName,
} from './token-name-context';

const PAGE_SIZE = 25;

const EMPTY_PREVIEW_HEADERS = [
  'Agent session',
  'Tool',
  'Status',
  'Last activity',
];
const EMPTY_PREVIEW_COLUMNS =
  '40px minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 0.7fr)';
const EMPTY_PREVIEW_ROWS: GhostRow[] = [
  [
    { kind: 'icon', icon: Bot },
    { kind: 'title', text: 'Claude Desktop', subtext: '3 tool calls' },
    { kind: 'badge', text: 'search_catalog' },
    { kind: 'status', text: 'Succeeded' },
    { kind: 'text', text: 'Just now' },
  ],
  [
    { kind: 'icon', icon: Laptop },
    { kind: 'title', text: 'Cursor', subtext: '2 tool calls' },
    { kind: 'badge', text: 'get_entity' },
    { kind: 'status', text: 'Succeeded' },
    { kind: 'text', text: '3m ago' },
  ],
  [
    { kind: 'icon', icon: Terminal },
    { kind: 'title', text: 'Codex', subtext: '5 tool calls' },
    { kind: 'badge', text: 'run_action' },
    { kind: 'status', text: 'Succeeded' },
    { kind: 'text', text: '8m ago' },
  ],
];

const TIME_RANGES = [
  { value: 'all', label: 'All time' },
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;

function timeRangeToIso(value: string): string | undefined {
  const now = DateTime.now();
  switch (value) {
    case '1h':
      return now.minus({ hours: 1 }).toISO() ?? undefined;
    case '6h':
      return now.minus({ hours: 6 }).toISO() ?? undefined;
    case '24h':
      return now.minus({ hours: 24 }).toISO() ?? undefined;
    case '7d':
      return now.minus({ days: 7 }).toISO() ?? undefined;
    case '30d':
      return now.minus({ days: 30 }).toISO() ?? undefined;
    default:
      return undefined;
  }
}

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  serviceFilter: string;
  onServiceChange: (v: string) => void;
  toolFilter: string;
  onToolChange: (v: string) => void;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  userFilter: string;
  onUserChange: (v: string) => void;
  escalationFilter: string;
  onEscalationChange: (v: string) => void;
  timeRange: string;
  onTimeRangeChange: (v: string) => void;
  facets: McpAuditFacets | null;
  loading: boolean;
  onRefresh: () => void;
}

function FilterBar({
  search,
  onSearchChange,
  serviceFilter,
  onServiceChange,
  toolFilter,
  onToolChange,
  statusFilter,
  onStatusChange,
  userFilter,
  onUserChange,
  escalationFilter,
  onEscalationChange,
  timeRange,
  onTimeRangeChange,
  facets,
  loading,
  onRefresh,
}: FilterBarProps) {
  const resolveCustomerName = useResolveCustomerName();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <OverviewListingSearchField
        value={search}
        onValueChange={onSearchChange}
        placeholder="Search tools, services, correlation IDs…"
        ariaLabel="Search audit log"
        layout="pageHeader"
      />
      <Select value={escalationFilter} onValueChange={onEscalationChange}>
        <SelectTrigger className="w-[170px]">
          <SelectValue placeholder="Escalations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sessions</SelectItem>
          <SelectItem value="true">With escalations</SelectItem>
          <SelectItem value="false">Without escalations</SelectItem>
        </SelectContent>
      </Select>
      <Select value={timeRange} onValueChange={onTimeRangeChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Time range" />
        </SelectTrigger>
        <SelectContent>
          {TIME_RANGES.map(r => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={toolFilter} onValueChange={onToolChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Tool" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All tools</SelectItem>
          {facets?.tools.map(t => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={serviceFilter} onValueChange={onServiceChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Service" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All services</SelectItem>
          {facets?.services.map(s => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="success">success</SelectItem>
          <SelectItem value="error">error</SelectItem>
        </SelectContent>
      </Select>
      <Select value={userFilter} onValueChange={onUserChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="User" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All users</SelectItem>
          {facets?.users.map(u => (
            <SelectItem key={u} value={u}>
              {resolveCustomerName(u)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh"
      >
        <RefreshCw className={cn('size-4', loading && 'motion-icon-spin')} />
      </Button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex h-full flex-col px-4 pt-4 sm:px-6">
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

function EscalationStats({ facets }: { facets: McpAuditFacets }) {
  const { escalationCount, totalSessionCount } = facets;
  if (!totalSessionCount) return null;

  const pct = Math.round((escalationCount / totalSessionCount) * 100);

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        <span className="text-foreground">{totalSessionCount}</span> sessions
      </span>
      <span>·</span>
      <span className="flex items-center gap-1 tabular-nums">
        <Zap className="size-3 text-warning" />
        <span className="text-foreground">{escalationCount}</span> with
        escalations ({pct}%)
      </span>
    </div>
  );
}

export function McpAuditLogPage() {
  return (
    <TokenNameProvider>
      <McpAuditLogPageContent />
    </TokenNameProvider>
  );
}

function McpAuditLogPageContent() {
  const navigate = useNavigate();
  const client = useMcpAudit();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [toolFilter, setToolFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [escalationFilter, setEscalationFilter] = useState('all');
  const [timeRange, setTimeRange] = useState('all');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Batching the page reset with the debounced value keeps them in one
  // commit, so the query key changes once with the new search and page 0
  // instead of firing an extra request with the stale page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const auditQuery = useQuery({
    // Keyed on the timeRange selection, not the resolved timestamp — the ISO
    // `from` is derived from now() and would change the key every render.
    queryKey: workspaceQueryKey('mcpAuditLog', 'entries', {
      page,
      pageSize: PAGE_SIZE,
      search: debouncedSearch,
      service: serviceFilter,
      tool: toolFilter,
      status: statusFilter,
      user: userFilter,
      escalation: escalationFilter,
      timeRange,
    }),
    queryFn: () =>
      client.getAuditLog({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        service: serviceFilter !== 'all' ? serviceFilter : undefined,
        tool: toolFilter !== 'all' ? toolFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        customerId: userFilter !== 'all' ? userFilter : undefined,
        hasEscalation:
          escalationFilter !== 'all' ? escalationFilter === 'true' : undefined,
        from: timeRangeToIso(timeRange),
      }),
    placeholderData: keepPreviousData,
  });

  const facetsQuery = useQuery(mcpAuditFacetsQuery(client));

  const entries = auditQuery.data?.items;
  const totalCount = auditQuery.data?.totalCount ?? 0;
  // Facet errors are non-critical — dropdowns fall back to empty.
  const facets = facetsQuery.data ?? null;
  const error = auditQuery.error;
  const fetching = auditQuery.isFetching;

  useEffect(() => {
    setPage(0);
  }, [
    serviceFilter,
    toolFilter,
    statusFilter,
    userFilter,
    escalationFilter,
    timeRange,
  ]);

  const { refetch: refetchAudit } = auditQuery;
  const { refetch: refetchFacets } = facetsQuery;
  const handleRefresh = useCallback(() => {
    void refetchAudit();
    void refetchFacets();
  }, [refetchAudit, refetchFacets]);

  const groups = useMemo(() => groupByCorrelation(entries ?? []), [entries]);

  const hasActiveFilters =
    search !== '' ||
    serviceFilter !== 'all' ||
    toolFilter !== 'all' ||
    statusFilter !== 'all' ||
    userFilter !== 'all' ||
    escalationFilter !== 'all' ||
    timeRange !== 'all';

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedGroupId(null);
    } else if (!groups.find(g => g.correlationId === selectedGroupId)) {
      setSelectedGroupId(groups[0]!.correlationId);
    }
  }, [groups, selectedGroupId]);

  const selectedGroup = useMemo(
    () =>
      groups.find(g => g.correlationId === selectedGroupId) ??
      groups[0] ??
      null,
    [groups, selectedGroupId],
  );

  const pageCount = Math.ceil(totalCount / PAGE_SIZE);
  const showingFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalCount);

  // First load only — keepPreviousData keeps rows visible on page/filter
  // changes, so isLoading is false once any data has ever been shown.
  if (auditQuery.isLoading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="flex h-full flex-col px-4 pt-4 sm:px-6">
      <div className="shrink-0 space-y-3 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Agent Sessions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            History of MCP tool calls made by AI agents and external clients,
            grouped by correlation.
          </p>
        </div>

        {facets && <EscalationStats facets={facets} />}

        {totalCount > 0 || hasActiveFilters || error ? (
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            serviceFilter={serviceFilter}
            onServiceChange={setServiceFilter}
            toolFilter={toolFilter}
            onToolChange={setToolFilter}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            userFilter={userFilter}
            onUserChange={setUserFilter}
            escalationFilter={escalationFilter}
            onEscalationChange={setEscalationFilter}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            facets={facets}
            loading={fetching}
            onRefresh={handleRefresh}
          />
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error.message}</p>
        </div>
      ) : (entries?.length ?? 0) === 0 && hasActiveFilters ? (
        <EmptyState
          icon={<ScrollText className="h-8 w-8" />}
          title="No matching agent sessions"
          description="No sessions match your current filters."
        />
      ) : (entries?.length ?? 0) === 0 ? (
        <OverviewEmptyPreview
          actionDelay={ghostSettleAt(EMPTY_PREVIEW_ROWS.length, 5)}
          title="No agent sessions yet"
          description="Connect an MCP client and ask it to use an OpenRoadie tool. Its session will appear here."
          preview={
            <GhostTablePreview
              headers={EMPTY_PREVIEW_HEADERS}
              columns={EMPTY_PREVIEW_COLUMNS}
              rows={EMPTY_PREVIEW_ROWS}
            />
          }
          action={
            <Button
              variant="outline"
              onClick={() => navigate(PATHS.ADMIN_MCP_SERVERS)}
            >
              Connect an MCP client
              <ArrowRight />
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <div className="w-2/5 overflow-y-auto border-r border-border">
              <SessionList
                groups={groups}
                selectedId={selectedGroupId}
                onSelect={setSelectedGroupId}
              />
            </div>

            <div className="w-3/5 overflow-y-auto">
              <SessionDetail group={selectedGroup} />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between py-4">
            <p className="text-sm text-muted-foreground">
              Showing{' '}
              <span className="text-foreground tabular-nums">
                {showingFrom}
              </span>
              –<span className="text-foreground tabular-nums">{showingTo}</span>{' '}
              of{' '}
              <span className="text-foreground tabular-nums">{totalCount}</span>{' '}
              session{totalCount !== 1 ? 's' : ''}
            </p>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-[5.5rem] text-center text-sm text-muted-foreground tabular-nums">
                  Page {page + 1} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage(p => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
