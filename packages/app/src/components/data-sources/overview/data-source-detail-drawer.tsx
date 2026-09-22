import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Database, ExternalLink } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@roadiehq/ui/alert';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import {
  StatusDot,
  type StatusIndicatorTone,
} from '@roadiehq/ui/status-indicator';
import {
  DetailDrawer,
  DetailSection,
  StatBadges,
  DetailFields,
  formatRelative,
  formatAbsolute,
  type StatBadge,
} from '../../common';
import { OverviewStatusCell, toExecutionOutcome } from '../../overview';
import {
  contextGroupEdit,
  dataSourceDetail,
  dataSourceObjects,
  integrationDetail,
} from '../../../config/paths';
import type { DataSourceItem } from '../types';
import { getDataSourceOverviewStatus } from '../data-source-status';
import type { IntegrationSecretSummary } from '../../integrations/use-integration-secret-status';
import { useDatastore } from '../../../api';
import { allDirectRelationshipsQuery } from '../../../api/queries';
import { DataSourceObjectPreview } from './data-source-object-preview';
import { DataSourceRelationshipRules } from './data-source-relationship-rules';
import {
  useDataSourceDetail,
  type DataSourceRelationshipRule,
} from './use-data-source-detail';
import { LargePayloadAlert } from '../large-payload-warning';

export interface DataSourceDetailDrawerProps {
  /** URL-selected id. Kept separate so deep links can load without list data. */
  dataSourceId: string | null;
  /** The row being previewed, from the list. `undefined` while none selected. */
  dataSource: DataSourceItem | undefined;
  /** Resolves related data source ids (in relationship rules) to display names. */
  dataSourceNameById: Map<string, string>;
  /** Enabled data source ids — gates the per-relationship "view in graph" link
   * so it's only shown when both endpoints would render in the editor. */
  enabledDataSourceIds: ReadonlySet<string>;
  /** Per-integration secret readiness, computed once by the overview. */
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>;
  secretStatusLoading: boolean;
  open: boolean;
  /** True while the data sources list is still loading for a deep-linked id. */
  listLoading?: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detail drawer for a Data Sources row. Common fields + status/last-run come
 * straight from the list row; object preview and cross-cutting counts are
 * fetched on demand via {@link useDataSourceDetail}.
 */
export function DataSourceDetailDrawer({
  dataSourceId,
  dataSource: listDataSource,
  dataSourceNameById,
  enabledDataSourceIds,
  summariesByIntegrationId,
  secretStatusLoading,
  open,
  listLoading = false,
  onOpenChange,
}: DataSourceDetailDrawerProps) {
  const notFound =
    open && dataSourceId != null && !listDataSource && !listLoading;
  const listRowLoading =
    open && listLoading && dataSourceId != null && !listDataSource;
  const {
    detail,
    loading: detailLoading,
    error: detailError,
  } = useDataSourceDetail(
    open && dataSourceId && (listLoading || listDataSource)
      ? dataSourceId
      : null,
  );
  // Direct (non-rule) edges touching this source, aggregated per related
  // source + direction + type into synthetic rows alongside the rule rows.
  const datastoreApi = useDatastore();
  const directRelationshipsResult = useQuery({
    ...allDirectRelationshipsQuery(datastoreApi),
    enabled: open && !!dataSourceId,
  });
  const directRuleRows = useMemo<DataSourceRelationshipRule[]>(() => {
    if (!dataSourceId) return [];
    const groups = new Map<string, DataSourceRelationshipRule>();
    for (const rel of directRelationshipsResult.data?.items ?? []) {
      const outbound = rel.sourceDatasourceId === dataSourceId;
      const inbound = rel.destinationDatasourceId === dataSourceId;
      if (!outbound && !inbound) continue;
      const direction = outbound ? 'outbound' : 'inbound';
      const relatedDatasourceId = outbound
        ? rel.destinationDatasourceId
        : rel.sourceDatasourceId;
      const key = `${relatedDatasourceId}|${direction}|${rel.relationshipType}`;
      const existing = groups.get(`${key}`);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(`${key}`, {
          id: `direct-${key}`,
          name: 'Direct relationships',
          relationshipType: rel.relationshipType,
          direction,
          relatedDatasourceId,
          count: 1,
          direct: true,
        });
      }
    }
    return [...groups.values()];
  }, [directRelationshipsResult.data, dataSourceId]);

  const relationshipRows = useMemo(
    () => [...(detail?.relationshipRules ?? []), ...directRuleRows],
    [detail?.relationshipRules, directRuleRows],
  );

  // Only the deep-link case (a selected id with no row yet) blanks the whole
  // drawer. The on-demand `detailLoading`/`detailError` are supplementary — the
  // Details below come straight from the list row — so they stay scoped to the
  // sections that actually need the fetch (see the on-demand block below).
  const loading = listRowLoading;
  const error = notFound ? 'Data source not found.' : undefined;

  const execution = listDataSource?.execution?.isDryRun
    ? undefined
    : listDataSource?.execution;
  const lastRun = formatRelative(execution?.lastRunAt);
  const runOutcome = toExecutionOutcome({
    status: execution?.status,
    objectCount: execution?.objectCount,
    lastRunAt: execution?.lastRunAt,
  });
  const runIsRunning = runOutcome === 'running';
  const runTone: StatusIndicatorTone =
    runOutcome === 'partial'
      ? 'warning'
      : runOutcome === 'failed'
        ? 'destructive'
        : runIsRunning
          ? 'neutral'
          : 'success';

  const objectCount =
    listDataSource?.objectCount ??
    detail?.objectTotal ??
    execution?.objectCount;

  // detail.relationshipCount covers rule edges only; the table below merges in
  // the direct rows, so the stat must count them too or it undercounts.
  const directEdgeCount = directRuleRows.reduce(
    (sum, row) => sum + row.count,
    0,
  );

  const stats: StatBadge[] = listDataSource
    ? [
        {
          label: 'Objects',
          value: objectCount != null ? objectCount.toLocaleString() : '—',
          href: dataSourceObjects(listDataSource.id),
        },
        {
          label: 'Relationships',
          value:
            detail != null
              ? (detail.relationshipCount + directEdgeCount).toLocaleString()
              : '—',
        },
        {
          label: 'Context groups',
          value: detail?.contextGroups.length ?? '—',
        },
      ]
    : [];

  const status = listDataSource
    ? getDataSourceOverviewStatus(
        listDataSource,
        summariesByIntegrationId,
        secretStatusLoading,
      )
    : undefined;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={listDataSource?.name ?? 'Data source'}
      subtitle={listDataSource?.slug}
      icon={
        <IntegrationIconFrame size="group">
          {listDataSource?.logoUrl ? (
            <IntegrationLogo src={listDataSource.logoUrl} size={16} />
          ) : (
            <Database className="size-4 shrink-0 text-muted-foreground" />
          )}
        </IntegrationIconFrame>
      }
      editAction={
        listDataSource
          ? { type: 'link', href: dataSourceDetail(listDataSource.id) }
          : undefined
      }
      loading={loading}
      error={error}
    >
      {listDataSource && (
        <>
          {status && !status.pending && status.tone === 'warning' && (
            <Alert
              variant="default"
              className="border-warning/40 bg-warning/10"
            >
              <AlertTriangle className="size-4 text-warning" />
              <AlertTitle>{status.label}</AlertTitle>
              <AlertDescription>{status.tooltip}</AlertDescription>
            </Alert>
          )}

          {execution?.largePayloadWarning && (
            <LargePayloadAlert warning={execution.largePayloadWarning} />
          )}

          <DetailSection title="Details">
            <StatBadges stats={stats} />

            <DetailFields
              fields={[
                {
                  label: 'Status',
                  value: status?.pending ? (
                    <Skeleton
                      data-testid="data-source-status-loading-skeleton"
                      aria-hidden="true"
                      className="h-4 w-16 rounded sm:h-5"
                    />
                  ) : (
                    status && <OverviewStatusCell expanded {...status} />
                  ),
                },
                {
                  label: 'Last run',
                  value:
                    lastRun || runIsRunning ? (
                      <span className="flex items-center gap-1.5">
                        <StatusDot
                          tone={runTone}
                          pulse={runIsRunning}
                          className="size-1.5"
                        />
                        {runIsRunning ? (
                          <span>Running…</span>
                        ) : (
                          <span title={formatAbsolute(execution?.lastRunAt)}>
                            {lastRun}
                          </span>
                        )}
                      </span>
                    ) : undefined,
                },
                {
                  label: 'Integration',
                  value: (() => {
                    const integrationId =
                      listDataSource.integration?.id ??
                      listDataSource.integrationId;
                    const label = listDataSource.integration?.label;
                    if (!label) return undefined;
                    return integrationId ? (
                      <Link
                        to={integrationDetail(integrationId)}
                        className="motion-colors inline-flex min-w-0 items-center gap-1 text-surface-foreground hover:underline"
                      >
                        <span className="truncate">{label}</span>
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                      </Link>
                    ) : (
                      label
                    );
                  })(),
                },
                {
                  label: 'Created',
                  value: (
                    <span title={formatAbsolute(listDataSource.createdAt)}>
                      {formatRelative(listDataSource.createdAt)}
                    </span>
                  ),
                },
                {
                  label: 'Updated',
                  value: (
                    <span title={formatAbsolute(listDataSource.updatedAt)}>
                      {formatRelative(listDataSource.updatedAt)}
                    </span>
                  ),
                },
              ]}
            />
          </DetailSection>

          {listDataSource.description && (
            <DetailSection title="Description">
              <p className="text-sm text-surface-foreground">
                {listDataSource.description}
              </p>
            </DetailSection>
          )}

          {/* Objects, relationships, and context groups are fetched on demand;
              a failure here leaves the list-row details above intact. */}
          {detailError ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Couldn't load related data</AlertTitle>
              <AlertDescription>
                Objects, relationship rules, and context groups for this data
                source couldn't be loaded. The details above are still accurate.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {detail && detail.contextGroups.length > 0 && (
                <DetailSection title="Context groups">
                  <div className="flex flex-wrap gap-1.5">
                    {detail.contextGroups.map(group => (
                      <Link key={group.id} to={contextGroupEdit(group.id)}>
                        <Badge
                          variant="outline"
                          className="motion-colors gap-1 hover:bg-accent"
                        >
                          {group.name}
                          <ExternalLink className="size-3 text-muted-foreground" />
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </DetailSection>
              )}
            </>
          )}

          {/* Outside the detailError branch: the direct rows come from their
              own query, so a rules-detail failure must not hide them. Only
              skeleton while nothing is showable yet — ready direct rows stay
              visible while the rules detail is still loading. */}
          {relationshipRows.length > 0 && (
            <DataSourceRelationshipRules
              rules={relationshipRows}
              currentDataSourceId={listDataSource.id}
              nameById={dataSourceNameById}
              enabledDataSourceIds={enabledDataSourceIds}
              loading={detailLoading && directRuleRows.length === 0}
            />
          )}

          {!detailError && (
            <DataSourceObjectPreview
              dataSourceId={listDataSource.id}
              objectCount={objectCount}
              rows={detail?.objectPreview ?? []}
              loading={detailLoading}
            />
          )}
        </>
      )}
    </DetailDrawer>
  );
}
