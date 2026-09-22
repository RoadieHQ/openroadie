import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@roadiehq/ui/alert';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@roadiehq/ui/card';
import { EditorHeader } from '@roadiehq/ui/editor-header';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { Bot, Clock3, Users } from 'lucide-react';
import {
  DetailFields,
  DetailSection,
  EntityEditorShell,
  formatAbsolute,
  formatRelative,
} from '../../common';
import { useDatastore, useMcpAudit } from '../../../api';
import {
  contextGroupRuleDetailQuery,
  relationshipRulesAllQuery,
} from '../../../api/queries';
import { workspaceQueryKey } from '../../../api/workspace-scope';
import {
  PATHS,
  contextGroupEdit,
  relationshipsScoped,
} from '../../../config/paths';
import { DatasourcePreview } from './datasource-preview';
import { ContextGroupInstancesSection } from './context-group-instances-section';
import {
  ContextGroupRelationshipsSection,
  type ContextGroupRelationshipRow,
} from './context-group-relationships-section';
import { ContextGroupReadinessAlert } from './context-group-readiness-alert';
import { useContextGroupRuleStats } from '../use-context-groups';
import { useDataSources } from '../../data-sources/use-data-sources';
import { loadRecentRuleAgentUsage } from '../recent-agent-usage';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function RuleRecentAgentUsageCard({ ruleId }: { ruleId: string }) {
  const api = useDatastore();
  const audit = useMcpAudit();
  const recentUsageQuery = useQuery({
    queryKey: workspaceQueryKey('mcpAuditLog', 'contextGroupRuleUsage', ruleId),
    queryFn: () => loadRecentRuleAgentUsage(api, audit, ruleId),
    retry: false,
  });
  const matchingEntries = recentUsageQuery.data ?? [];
  const loading = recentUsageQuery.isPending;
  const error = recentUsageQuery.error;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4" />
          Recent Agent Usage
        </CardTitle>
        <CardDescription>
          Recent MCP bundle lookups across this rule&apos;s groups.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Audit log access is unavailable for this view.
          </div>
        ) : matchingEntries.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            No recent bundle lookups were found for this rule&apos;s groups.
          </div>
        ) : (
          <div className="space-y-2">
            {matchingEntries.map(entry => (
              <div
                key={entry.id}
                className="rounded-md border border-border bg-muted/20 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {entry.correlationId}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="size-3.5" />
                      {dateFormatter.format(new Date(entry.createdAt))}
                    </div>
                  </div>
                  <Badge
                    variant={
                      entry.status === 'success' ? 'secondary' : 'destructive'
                    }
                    className="shrink-0 rounded-full"
                  >
                    {entry.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" asChild className="mt-4">
          <Link to={PATHS.ADMIN_MCP_AUDIT_LOG}>Open audit log</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Loading and error both keep the rail — the back control and the section
 * breadcrumb are useful precisely when the page can't render (loading-states
 * #2), and dropping them used to change the body width as well.
 */
function ContextGroupDetailShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <EntityEditorShell>
      <EditorHeader
        title={title}
        backTo={PATHS.CONTEXT_GROUPS}
        breadcrumb="Context groups"
        breadcrumbPath={PATHS.CONTEXT_GROUPS}
        icon={
          <IntegrationIconFrame size="row">
            <Users className="size-4 shrink-0 text-primary" />
          </IntegrationIconFrame>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          {children}
        </div>
      </main>
    </EntityEditorShell>
  );
}

export function ContextGroupDetailPage() {
  const { groupId = '' } = useParams<{ groupId: string }>();
  const datastore = useDatastore();
  const {
    data: rule,
    isPending,
    error,
  } = useQuery(contextGroupRuleDetailQuery(datastore, groupId));
  const {
    totalGroups,
    totalMembers,
    loading: statsLoading,
    error: statsError,
  } = useContextGroupRuleStats(rule?.id);
  const { dataSources } = useDataSources({ skipExecutions: true });
  const enabledDataSourceIds = useMemo(
    () => new Set(dataSources.filter(ds => ds.enabled).map(ds => ds.id)),
    [dataSources],
  );
  const { data: relationshipRulesData, isLoading: relationshipRulesLoading } =
    useQuery({
      ...relationshipRulesAllQuery(datastore),
      enabled: !!rule,
    });

  const relationshipRows = useMemo<ContextGroupRelationshipRow[]>(() => {
    if (!rule) {
      return [];
    }

    const nameById = new Map<string, string>();
    const datasourceIds = new Set<string>();
    for (const filter of rule.datasources) {
      if (filter.datasourceId) {
        datasourceIds.add(filter.datasourceId);
        nameById.set(
          filter.datasourceId,
          filter.status?.displayName ?? filter.seedName ?? filter.datasourceId,
        );
      }
    }

    const selectedTypes = new Set(rule.mergeRelationshipTypes);
    const matched = (relationshipRulesData?.items ?? []).filter(
      relationshipRule =>
        relationshipRule.state === 'active' &&
        selectedTypes.has(relationshipRule.relationshipType) &&
        datasourceIds.has(relationshipRule.sourceDatasourceId) &&
        datasourceIds.has(relationshipRule.targetDatasourceId),
    );

    const matchedRows: ContextGroupRelationshipRow[] = matched
      .map(relationshipRule => ({
        key: relationshipRule.id,
        relationshipType: relationshipRule.relationshipType,
        source: {
          id: relationshipRule.sourceDatasourceId,
          name: nameById.get(relationshipRule.sourceDatasourceId) ?? '',
        },
        target: {
          id: relationshipRule.targetDatasourceId,
          name: nameById.get(relationshipRule.targetDatasourceId) ?? '',
        },
        viewable:
          enabledDataSourceIds.has(relationshipRule.sourceDatasourceId) &&
          enabledDataSourceIds.has(relationshipRule.targetDatasourceId),
      }))
      .sort((a, b) =>
        a.relationshipType === b.relationshipType
          ? (a.source?.name ?? '').localeCompare(b.source?.name ?? '')
          : a.relationshipType.localeCompare(b.relationshipType),
      );

    const typesWithRules = new Set(matched.map(item => item.relationshipType));
    const unmatchedRows: ContextGroupRelationshipRow[] =
      rule.mergeRelationshipTypes
        .filter(type => !typesWithRules.has(type))
        .map(type => ({ key: `type:${type}`, relationshipType: type }));

    return [...matchedRows, ...unmatchedRows];
  }, [enabledDataSourceIds, relationshipRulesData, rule]);

  const viewableGroupDatasourceIds = useMemo(() => {
    if (!rule) {
      return [];
    }

    const ids = new Set<string>();
    for (const filter of rule.datasources) {
      if (
        filter.datasourceId &&
        enabledDataSourceIds.has(filter.datasourceId)
      ) {
        ids.add(filter.datasourceId);
      }
    }

    return Array.from(ids);
  }, [enabledDataSourceIds, rule]);

  if (isPending) {
    return (
      <ContextGroupDetailShell title="Context group">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </ContextGroupDetailShell>
    );
  }

  if (error || !rule) {
    return (
      <ContextGroupDetailShell title="Context group">
        <Card>
          <CardContent className="p-5 text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : 'Context group not found.'}
          </CardContent>
        </Card>
      </ContextGroupDetailShell>
    );
  }

  return (
    <EntityEditorShell>
      <EditorHeader
        title={rule.name}
        backTo={PATHS.CONTEXT_GROUPS}
        breadcrumb="Context groups"
        breadcrumbPath={PATHS.CONTEXT_GROUPS}
        icon={
          <IntegrationIconFrame size="row">
            <Users className="size-4 shrink-0 text-primary" />
          </IntegrationIconFrame>
        }
        titleAdornment={
          <>
            <Badge variant="outlineMuted" className="rounded-full">
              {rule.slug}
            </Badge>
            <Badge variant="outlineMuted" className="rounded-full">
              {statsLoading ? '…' : `${totalGroups.toLocaleString()} groups`}
            </Badge>
          </>
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={contextGroupEdit(rule.id)}>Edit</Link>
          </Button>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            {statsError ? (
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t load member counts</AlertTitle>
                <AlertDescription>{statsError.message}</AlertDescription>
              </Alert>
            ) : null}

            <ContextGroupReadinessAlert datasources={rule.datasources} />

            <DetailSection title="Details">
              <DetailFields
                className="sm:grid-cols-4"
                fields={[
                  {
                    label: 'Groups',
                    value: statsLoading ? (
                      <Skeleton className="h-5 w-8 rounded" />
                    ) : statsError ? (
                      '—'
                    ) : (
                      totalGroups.toLocaleString()
                    ),
                  },
                  {
                    label: 'Members',
                    value: statsLoading ? (
                      <Skeleton className="h-5 w-8 rounded" />
                    ) : statsError ? (
                      '—'
                    ) : (
                      totalMembers.toLocaleString()
                    ),
                  },
                  {
                    label: 'Created',
                    value: (
                      <span title={formatAbsolute(rule.createdAt)}>
                        {formatRelative(rule.createdAt)}
                      </span>
                    ),
                  },
                  {
                    label: 'Updated',
                    value: (
                      <span title={formatAbsolute(rule.updatedAt)}>
                        {formatRelative(rule.updatedAt)}
                      </span>
                    ),
                  },
                ]}
              />
            </DetailSection>

            {rule.description && (
              <DetailSection title="Description">
                <p className="text-sm text-surface-foreground">
                  {rule.description}
                </p>
              </DetailSection>
            )}

            <ContextGroupInstancesSection ruleId={rule.id} />

            <ContextGroupRelationshipsSection
              rows={relationshipRows}
              loading={relationshipRulesLoading}
              graphHref={
                viewableGroupDatasourceIds.length > 0
                  ? relationshipsScoped({
                      dataSourceIds: viewableGroupDatasourceIds,
                      relationshipTypes: rule.mergeRelationshipTypes,
                    })
                  : undefined
              }
            />

            <DatasourcePreview
              title="Data sources"
              filters={rule.datasources}
              editHref={contextGroupEdit(rule.id)}
            />
          </div>

          <aside className="space-y-5">
            <RuleRecentAgentUsageCard ruleId={rule.id} />
          </aside>
        </div>
      </main>
    </EntityEditorShell>
  );
}
