import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Clock3,
  Database,
  ExternalLink,
  Network,
  Users,
  Waypoints,
} from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@roadiehq/ui/card';
import {
  EditorHeader,
  type EditorHeaderBreadcrumb,
} from '@roadiehq/ui/editor-header';
import { EmptyState } from '@roadiehq/ui/empty-state';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@roadiehq/ui/tabs';
import {
  DetailSection,
  EntityEditorShell,
  StatBadges,
  type StatBadge,
} from '../../common';
import { useDatastore, useMcpAudit } from '../../../api';
import { contextGroupInstanceQuery } from '../../../api/queries';
import { workspaceQueryKey } from '../../../api/workspace-scope';
import type {
  ContextGroupBundle,
  ContextGroupBundleMember,
  ContextGroupBundleRelationship,
} from '../../../api/datastore/datastore-client';
import type { McpAuditLogEntry } from '../../../api/mcp-audit';
import {
  PATHS,
  contextGroupDetail,
  contextGroupEdit,
  objectDetail,
  relationshipsScoped,
} from '../../../config/paths';
import { useDataSources } from '../../data-sources/use-data-sources';
import { humanizeRelationshipTypeLabel } from '../../data-sources/humanize-relationship-type';
import { ViewRelationshipGraphButton } from '../../relationships/view-relationship-graph-button';
import {
  CONTEXT_GROUP_BUNDLE_TOOL,
  RECENT_AGENT_USAGE_AUDIT_SAMPLE_SIZE,
  auditEntryGroupId,
  isContextGroupBundleAuditEntry,
  sortAuditEntriesByMostRecent,
} from '../recent-agent-usage';

const MEMBER_SAMPLE_SIZE = 48;
const RELATIONSHIP_SAMPLE_SIZE = 60;

const countFormatter = new Intl.NumberFormat();
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatCount(value: number): string {
  return countFormatter.format(value);
}

function bundleTotals(bundle: ContextGroupBundle) {
  return {
    members: bundle.totalMembers ?? bundle.members.length,
    internalRelationships:
      bundle.totalInternalRelationships ?? bundle.internalRelationships.length,
    externalRelationships:
      bundle.totalExternalRelationships ?? bundle.externalRelationships.length,
  };
}

function initialsForTitle(title: string): string {
  const parts = title.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return title.slice(0, 2).toUpperCase();
}

function MemberCard({
  member,
  dataSourceName,
}: {
  member: ContextGroupBundleMember;
  dataSourceName: string;
}) {
  return (
    <Link
      to={objectDetail(member.datasourceId, member.objectId)}
      className="motion-colors flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-xs font-semibold text-primary">
        {initialsForTitle(member.presentation.title)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {member.presentation.title}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {member.presentation.subtitle ?? dataSourceName}
        </div>
        <div className="truncate font-mono text-2xs text-muted-foreground/70">
          ID {member.objectId}
        </div>
      </div>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** A section's own footnote: only mentions sampling when the loaded set is
 * actually a subset — an exact "showing X of Y" reads as noise once X === Y. */
function sampleNote(loadedCount: number, total: number): string | null {
  const hiddenCount = Math.max(0, total - loadedCount);
  return hiddenCount > 0
    ? ` Showing ${formatCount(loadedCount)} of ${formatCount(total)}.`
    : null;
}

function MembersSection({
  title,
  description,
  members,
  total,
  dataSourceNames,
}: {
  title: string;
  description: string;
  members: ContextGroupBundleMember[];
  total: number;
  dataSourceNames: Map<string, string>;
}) {
  return (
    <DetailSection title={title} count={total}>
      <p className="text-sm text-muted-foreground">
        {description}
        {sampleNote(members.length, total)}
      </p>
      {members.length === 0 ? (
        <EmptyState
          title="No records"
          description="This group does not currently include records in this section."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {members.map(member => (
            <MemberCard
              key={`${member.datasourceId}:${member.objectId}`}
              member={member}
              dataSourceName={
                dataSourceNames.get(member.datasourceId) ?? member.datasourceId
              }
            />
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function RelationshipRow({
  relationship,
  dataSourceNames,
}: {
  relationship: ContextGroupBundleRelationship;
  dataSourceNames: Map<string, string>;
}) {
  const sourceLabel =
    relationship.source.presentation?.title ?? relationship.source.objectId;
  const destinationLabel =
    relationship.destination.presentation?.title ??
    relationship.destination.objectId;

  return (
    <div className="grid gap-3 border-b border-divider px-4 py-3 last:border-b-0 md:grid-cols-[1fr_auto_1fr] md:items-center">
      <Link
        to={objectDetail(
          relationship.source.datasourceId,
          relationship.source.objectId,
        )}
        className="min-w-0 hover:underline"
      >
        <div className="truncate text-sm font-medium text-foreground">
          {sourceLabel}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {dataSourceNames.get(relationship.source.datasourceId) ??
            relationship.source.datasourceId}
        </div>
      </Link>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Waypoints className="size-3.5" />
        {humanizeRelationshipTypeLabel(relationship.relationshipType)}
      </div>
      <Link
        to={objectDetail(
          relationship.destination.datasourceId,
          relationship.destination.objectId,
        )}
        className="min-w-0 hover:underline md:text-right"
      >
        <div className="truncate text-sm font-medium text-foreground">
          {destinationLabel}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {dataSourceNames.get(relationship.destination.datasourceId) ??
            relationship.destination.datasourceId}
        </div>
      </Link>
    </div>
  );
}

function RelationshipsSection({
  title,
  description,
  relationships,
  total,
  dataSourceNames,
}: {
  title: string;
  description: string;
  relationships: ContextGroupBundleRelationship[];
  total: number;
  dataSourceNames: Map<string, string>;
}) {
  return (
    <DetailSection title={title} count={total}>
      <p className="text-sm text-muted-foreground">
        {description}
        {sampleNote(relationships.length, total)}
      </p>
      <div className="overflow-hidden rounded-md border border-divider">
        {relationships.length === 0 ? (
          <EmptyState
            title="No relationships"
            description="No matching relationships are currently included in this group."
            className="px-4"
          />
        ) : (
          relationships.map(relationship => (
            <RelationshipRow
              key={`${relationship.id}-${relationship.direction}`}
              relationship={relationship}
              dataSourceNames={dataSourceNames}
            />
          ))
        )}
      </div>
    </DetailSection>
  );
}

function auditEntryUsesGroup(
  entry: McpAuditLogEntry,
  groupId: string,
): boolean {
  return (
    isContextGroupBundleAuditEntry(entry) &&
    auditEntryGroupId(entry) === groupId
  );
}

function RecentAgentUsageCard({ groupId }: { groupId: string }) {
  const audit = useMcpAudit();
  const { data, error, isPending } = useQuery({
    queryKey: workspaceQueryKey('mcpAuditLog', 'contextGroupUsage', groupId),
    queryFn: () =>
      audit.getAuditLog({
        page: 0,
        pageSize: RECENT_AGENT_USAGE_AUDIT_SAMPLE_SIZE,
        tool: CONTEXT_GROUP_BUNDLE_TOOL,
      }),
    retry: false,
  });
  const entries = useMemo(
    () =>
      sortAuditEntriesByMostRecent(
        (data?.items ?? []).filter(entry =>
          auditEntryUsesGroup(entry, groupId),
        ),
      ).slice(0, 5),
    [data?.items, groupId],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4" />
          Recent Agent Usage
        </CardTitle>
        <CardDescription>
          Recent MCP bundle lookups that referenced this group.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Audit log access is unavailable for this view.
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            title="No recent lookups"
            description="This group was not found in the latest audited get-context-bundle calls."
          />
        ) : (
          <div className="space-y-2">
            {entries.map(entry => (
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

/** The rail, at every state — the rule crumb only once the bundle names it. */
function ContextGroupInstanceHeader({
  title,
  ruleCrumb,
  titleAdornment,
  actions,
}: {
  title: string;
  ruleCrumb?: EditorHeaderBreadcrumb;
  titleAdornment?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <EditorHeader
      title={title}
      backTo={PATHS.CONTEXT_GROUPS}
      breadcrumb={[
        { label: 'Context groups', to: PATHS.CONTEXT_GROUPS },
        ...(ruleCrumb ? [ruleCrumb] : []),
      ]}
      icon={
        <IntegrationIconFrame size="row">
          <Users className="size-4 shrink-0 text-primary" />
        </IntegrationIconFrame>
      }
      titleAdornment={titleAdornment}
      actions={actions}
    />
  );
}

/**
 * The group's contributing sources. Two fit the rail comfortably; the rest
 * collapse into a count with the full list available on click or focus.
 */
function DataSourceBadges({
  ids,
  names,
}: {
  ids: string[];
  names: Map<string, string>;
}) {
  const nameFor = (id: string) => names.get(id) ?? id;
  const visible = ids.slice(0, 2);
  const hidden = ids.slice(visible.length);
  return (
    <>
      {visible.map(id => (
        <Badge key={id} variant="outline" className="gap-1.5 rounded-full">
          <Database className="size-3" />
          {nameFor(id)}
        </Badge>
      ))}
      {hidden.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums"
              aria-label={`Show ${hidden.length} more data sources`}
            >
              +{hidden.length} more
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Additional data sources
            </p>
            <ul className="max-h-64 overflow-y-auto">
              {hidden.map(id => (
                <li
                  key={id}
                  className="flex items-start gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground"
                >
                  <Database className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">{nameFor(id)}</span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}

/** Loading and error keep the rail, so back and the breadcrumb stay reachable. */
function ContextGroupInstanceStatus({ children }: { children: ReactNode }) {
  return (
    <EntityEditorShell>
      <ContextGroupInstanceHeader title="Context group" />
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          {children}
        </div>
      </main>
    </EntityEditorShell>
  );
}

export function ContextGroupInstancePage() {
  const { groupId = '' } = useParams<{ groupId: string }>();
  const api = useDatastore();
  const { dataSources } = useDataSources({ skipExecutions: true });
  const bundleQueryOptions = {
    memberLimit: MEMBER_SAMPLE_SIZE,
    relationshipLimit: RELATIONSHIP_SAMPLE_SIZE,
  };
  const {
    data: bundle,
    isPending,
    error,
  } = useQuery(contextGroupInstanceQuery(api, groupId, bundleQueryOptions));
  const dataSourceNames = useMemo(
    () => new Map(dataSources.map(ds => [ds.id, ds.name])),
    [dataSources],
  );
  const dataSourceIds = useMemo(
    () =>
      bundle?.datasourceIds ?? [
        ...new Set((bundle?.members ?? []).map(member => member.datasourceId)),
      ],
    [bundle],
  );
  const enabledDataSourceIds = useMemo(
    () => new Set(dataSources.filter(ds => ds.enabled).map(ds => ds.id)),
    [dataSources],
  );
  const viewableDatasourceIds = useMemo(
    () => dataSourceIds.filter(id => enabledDataSourceIds.has(id)),
    [dataSourceIds, enabledDataSourceIds],
  );
  const graphHref =
    viewableDatasourceIds.length > 0
      ? relationshipsScoped({ dataSourceIds: viewableDatasourceIds })
      : undefined;
  if (isPending) {
    return (
      <ContextGroupInstanceStatus>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </ContextGroupInstanceStatus>
    );
  }

  if (error || !bundle) {
    return (
      <ContextGroupInstanceStatus>
        <Card>
          <CardContent className="p-5 text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : 'Context instance not found.'}
          </CardContent>
        </Card>
      </ContextGroupInstanceStatus>
    );
  }

  const totals = bundleTotals(bundle);
  const stats: StatBadge[] = [
    {
      label: 'Records',
      value: formatCount(totals.members),
      icon: <Users className="size-3.5" />,
    },
    {
      label: 'Internal relationships',
      value: formatCount(totals.internalRelationships),
      icon: <Network className="size-3.5" />,
    },
    {
      label: 'External relationships',
      value: formatCount(totals.externalRelationships),
      icon: <Waypoints className="size-3.5" />,
    },
  ];

  return (
    <EntityEditorShell>
      <ContextGroupInstanceHeader
        title={bundle.title}
        ruleCrumb={{
          label: bundle.ruleName,
          to: contextGroupDetail(bundle.ruleId),
        }}
        titleAdornment={
          <DataSourceBadges ids={dataSourceIds} names={dataSourceNames} />
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={contextGroupDetail(bundle.ruleId)}>View rule</Link>
          </Button>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          <StatBadges stats={stats} className="sm:grid-cols-3" />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              <Tabs defaultValue="records" className="w-full">
                <TabsList>
                  <TabsTrigger value="records">Records</TabsTrigger>
                  <TabsTrigger value="relationships">Relationships</TabsTrigger>
                </TabsList>
                <TabsContent value="records" className="space-y-5">
                  <MembersSection
                    title="Records"
                    description="The records that make up this context group."
                    members={bundle.members}
                    total={totals.members}
                    dataSourceNames={dataSourceNames}
                  />
                </TabsContent>
                <TabsContent value="relationships" className="space-y-5">
                  {graphHref ? (
                    <div className="flex justify-end">
                      <ViewRelationshipGraphButton to={graphHref} />
                    </div>
                  ) : null}
                  <RelationshipsSection
                    title="Internal Relationships"
                    description="Relationships where both ends are inside the group."
                    relationships={bundle.internalRelationships}
                    total={totals.internalRelationships}
                    dataSourceNames={dataSourceNames}
                  />
                  <RelationshipsSection
                    title="External Relationships"
                    description="Relationships that connect this group to the wider graph."
                    relationships={bundle.externalRelationships}
                    total={totals.externalRelationships}
                    dataSourceNames={dataSourceNames}
                  />
                </TabsContent>
              </Tabs>
            </div>

            <aside className="space-y-5">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Rule</CardTitle>
                  <CardDescription>
                    {bundle.ruleDescription ??
                      'This rule defines which records and relationships are included in the group.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={contextGroupEdit(bundle.ruleId)}>
                      Open editor
                    </Link>
                  </Button>
                </CardContent>
              </Card>
              <RecentAgentUsageCard groupId={bundle.id} />
            </aside>
          </div>
        </div>
      </main>
    </EntityEditorShell>
  );
}
