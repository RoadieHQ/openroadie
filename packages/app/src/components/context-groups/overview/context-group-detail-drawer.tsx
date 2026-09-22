import { useMemo } from 'react';
import { Link } from 'react-router';
import { Users, Waypoints } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@roadiehq/ui/alert';
import { Button } from '@roadiehq/ui/button';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import {
  DetailDrawer,
  DetailSection,
  StatBadges,
  DetailFields,
  formatRelative,
  formatAbsolute,
  type StatBadge,
} from '../../common';
import { useDatastore } from '../../../api';
import { relationshipRulesAllQuery } from '../../../api/queries';
import { contextGroupEdit, relationshipsScoped } from '../../../config/paths';
import type { ContextGroupRule } from '../types';
import { useContextGroupRuleStats } from '../use-context-groups';
import { useDataSources } from '../../data-sources/use-data-sources';
import { DatasourcePreview } from './datasource-preview';
import { ContextGroupReadinessAlert } from './context-group-readiness-alert';
import { ContextGroupInstancesSection } from './context-group-instances-section';
import {
  ContextGroupRelationshipsSection,
  type ContextGroupRelationshipRow,
} from './context-group-relationships-section';

export interface ContextGroupDetailDrawerProps {
  /** URL-selected id. `null` when the drawer is closed. */
  ruleId: string | null;
  /** The row being previewed, from the list. `undefined` while none selected. */
  rule: ContextGroupRule | undefined;
  open: boolean;
  /** True while the context groups list is still loading for a deep-linked id. */
  listLoading?: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detail drawer for a Context Groups row. Common fields (sources, relationship
 * types, timestamps, description) come straight from the list row; the
 * cross-cutting member counts are fetched on demand via
 * {@link useContextGroupRuleStats} while the drawer is open.
 */
export function ContextGroupDetailDrawer({
  ruleId,
  rule,
  open,
  listLoading = false,
  onOpenChange,
}: ContextGroupDetailDrawerProps) {
  const notFound = open && ruleId != null && !rule && !listLoading;
  const listRowLoading = open && listLoading && ruleId != null && !rule;
  const {
    totalGroups,
    totalMembers,
    loading: statsLoading,
    error: statsError,
  } = useContextGroupRuleStats(open && ruleId ? ruleId : undefined);

  // Resolve the concrete origin → target edges: fetch the relationship rules
  // (shared cache with the editor) and keep the active ones whose type is
  // selected and whose both endpoints are among the group's sources — the same
  // join the editor uses to derive a group's available types.
  const datastore = useDatastore();
  const { dataSources } = useDataSources({ skipExecutions: true });
  const enabledDataSourceIds = useMemo(
    () => new Set(dataSources.filter(ds => ds.enabled).map(ds => ds.id)),
    [dataSources],
  );
  const { data: relationshipRulesData, isLoading: relationshipRulesLoading } =
    useQuery({
      ...relationshipRulesAllQuery(datastore),
      enabled: open && !!rule,
    });

  const relationshipRows = useMemo<ContextGroupRelationshipRow[]>(() => {
    if (!rule) return [];
    const nameById = new Map<string, string>();
    const dsSet = new Set<string>();
    for (const filter of rule.datasources) {
      if (filter.datasourceId) {
        dsSet.add(filter.datasourceId);
        nameById.set(
          filter.datasourceId,
          filter.status?.displayName ?? filter.seedName ?? filter.datasourceId,
        );
      }
    }
    const selectedTypes = new Set(rule.mergeRelationshipTypes);
    const matched = (relationshipRulesData?.items ?? []).filter(
      r =>
        r.state === 'active' &&
        selectedTypes.has(r.relationshipType) &&
        dsSet.has(r.sourceDatasourceId) &&
        dsSet.has(r.targetDatasourceId),
    );
    const matchedRows: ContextGroupRelationshipRow[] = matched
      .map(r => ({
        key: r.id,
        relationshipType: r.relationshipType,
        source: {
          id: r.sourceDatasourceId,
          name: nameById.get(r.sourceDatasourceId) ?? '',
        },
        target: {
          id: r.targetDatasourceId,
          name: nameById.get(r.targetDatasourceId) ?? '',
        },
        viewable:
          enabledDataSourceIds.has(r.sourceDatasourceId) &&
          enabledDataSourceIds.has(r.targetDatasourceId),
      }))
      .sort((a, b) =>
        a.relationshipType === b.relationshipType
          ? a.source.name.localeCompare(b.source.name)
          : a.relationshipType.localeCompare(b.relationshipType),
      );
    const typesWithRules = new Set(matched.map(r => r.relationshipType));
    const unmatchedRows: ContextGroupRelationshipRow[] =
      rule.mergeRelationshipTypes
        .filter(type => !typesWithRules.has(type))
        .map(type => ({ key: `type:${type}`, relationshipType: type }));
    return [...matchedRows, ...unmatchedRows];
  }, [rule, relationshipRulesData, enabledDataSourceIds]);

  // Enabled group sources only — the editor omits disabled workflows.
  const viewableGroupDatasourceIds = useMemo(() => {
    if (!rule) return [];
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
  }, [rule, enabledDataSourceIds]);

  const statValue = (value: number) =>
    statsLoading ? (
      <Skeleton className="h-5 w-8 rounded" />
    ) : statsError ? (
      '—'
    ) : (
      value.toLocaleString()
    );

  const stats: StatBadge[] = rule
    ? [
        { label: 'Groups', value: statValue(totalGroups) },
        { label: 'Members', value: statValue(totalMembers) },
      ]
    : [];

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={rule?.name ?? 'Context group'}
      subtitle={rule?.slug}
      icon={
        <IntegrationIconFrame size="group">
          <Users className="size-4 shrink-0 text-primary" />
        </IntegrationIconFrame>
      }
      editAction={
        rule ? { type: 'link', href: contextGroupEdit(rule.id) } : undefined
      }
      secondaryActions={
        rule && viewableGroupDatasourceIds.length > 0 ? (
          <Button asChild variant="outline" size="icon" className="size-8">
            <Link
              to={relationshipsScoped({
                dataSourceIds: viewableGroupDatasourceIds,
                relationshipTypes: rule.mergeRelationshipTypes,
              })}
              aria-label="Open in relationships editor"
              title="Open in relationships editor"
            >
              <Waypoints className="size-4" />
            </Link>
          </Button>
        ) : undefined
      }
      loading={listRowLoading}
      error={notFound ? 'Context group not found.' : undefined}
    >
      {rule && (
        <>
          {statsError ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn't load member counts</AlertTitle>
              <AlertDescription>{statsError.message}</AlertDescription>
            </Alert>
          ) : null}
          <ContextGroupReadinessAlert datasources={rule.datasources} />
          <DetailSection title="Details">
            <StatBadges stats={stats} />

            <DetailFields
              fields={[
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

          <ContextGroupInstancesSection
            ruleId={rule.id}
            enabled={open}
            rowNavigation={false}
          />

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

          <DatasourcePreview title="Data sources" filters={rule.datasources} />
        </>
      )}
    </DetailDrawer>
  );
}
