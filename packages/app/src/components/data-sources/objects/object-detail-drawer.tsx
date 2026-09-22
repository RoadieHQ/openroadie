import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import {
  DetailDrawer,
  DetailSection,
  StatBadges,
  DetailFields,
  formatRelative,
  formatAbsolute,
  type StatBadge,
} from '../../common';
import { objectDetailQuery } from '../../../api/queries';
import { useDatastore } from '../../../api';
import { dataSourceDetail, objectDetail } from '../../../config/paths';
import { useDataSources } from '../use-data-sources';
import { resolveObjectDisplayName } from './resolve-object-display-name';
import { ObjectContextGroupsSection } from './detail/object-context-groups-section';
import { ObjectMetadataPanel } from './detail/object-metadata-panel';
import { ObjectRelationshipsCard } from './detail/object-relationships-card';
import { ObjectIdChip } from './object-id-chip';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldCount(objectJson: unknown): number {
  return isRecord(objectJson) ? Object.keys(objectJson).length : 0;
}

export interface ObjectDetailDrawerProps {
  /** Both ids are needed to fetch the object; resolved from the URL or row. */
  datasourceId: string | undefined;
  objectId: string | undefined;
  open: boolean;
  /** True while the objects list is still resolving URL ids from a deep link. */
  listLoading?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Outside clicks matching this selector swap the drawer's contents instead
   * of closing it. Defaults to overview-table rows; the graph view passes its
   * own canvas region. */
  keepOpenSelector?: string;
}

/**
 * Detail drawer for a DataStore object row. Mirrors the routed object detail
 * page (`data-source-object-detail-page.tsx`) inside the shared drawer shell,
 * reusing that page's context-groups / relationships / metadata sections. The
 * routed page stays reachable via the drawer's "Open" action.
 */
export function ObjectDetailDrawer({
  datasourceId,
  objectId,
  open,
  listLoading = false,
  onOpenChange,
  keepOpenSelector,
}: ObjectDetailDrawerProps) {
  const api = useDatastore();
  const { dataSources } = useDataSources({ skipExecutions: true });

  const {
    data: object,
    isLoading,
    error,
  } = useQuery({
    ...objectDetailQuery(api, datasourceId ?? '', objectId ?? ''),
    enabled: open && !!datasourceId && !!objectId,
  });

  const dataSource = dataSources.find(ds => ds.id === datasourceId);
  const dataSourceName = dataSource?.name ?? datasourceId;
  const displayName =
    object && objectId
      ? resolveObjectDisplayName(object.object, objectId, object.presentation)
      : (objectId ?? 'Object');
  const relationships = useMemo(
    () => object?.relationships ?? [],
    [object?.relationships],
  );

  const notFound =
    open && !listLoading && (datasourceId == null || objectId == null);
  const loading =
    open && !notFound && ((listLoading && !object) || (isLoading && !object));

  const stats: StatBadge[] = object
    ? [
        { label: 'Relationships', value: relationships.length },
        { label: 'Fields', value: fieldCount(object.object) },
      ]
    : [];

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={displayName}
      subtitle={objectId ? <ObjectIdChip objectId={objectId} /> : undefined}
      icon={
        <IntegrationIconFrame size="group">
          {dataSource?.logoUrl ? (
            <IntegrationLogo src={dataSource.logoUrl} size={16} />
          ) : (
            <Database className="size-4 shrink-0 text-muted-foreground" />
          )}
        </IntegrationIconFrame>
      }
      editAction={
        datasourceId && objectId
          ? { type: 'link', href: objectDetail(datasourceId, objectId) }
          : undefined
      }
      editLabel="Open"
      keepOpenSelector={keepOpenSelector}
      loading={loading}
      error={notFound ? 'Object not found.' : (error?.message ?? undefined)}
    >
      {object && datasourceId && objectId && (
        <>
          <DetailSection title="Details">
            <StatBadges stats={stats} />

            <DetailFields
              fields={[
                {
                  label: 'Data source',
                  value: (
                    <Link
                      to={dataSourceDetail(datasourceId)}
                      className="motion-colors truncate text-surface-foreground hover:underline"
                    >
                      {dataSourceName}
                    </Link>
                  ),
                },
                {
                  label: 'Object ID',
                  value: (
                    <span className="block truncate font-mono text-xs">
                      {objectId}
                    </span>
                  ),
                },
                {
                  label: 'Created',
                  value: (
                    <span title={formatAbsolute(object.createdAt)}>
                      {formatRelative(object.createdAt)}
                    </span>
                  ),
                },
                {
                  label: 'Updated',
                  value: (
                    <span title={formatAbsolute(object.updatedAt)}>
                      {formatRelative(object.updatedAt)}
                    </span>
                  ),
                },
              ]}
            />
          </DetailSection>

          <ObjectContextGroupsSection
            datasourceId={datasourceId}
            objectId={objectId}
          />
          <ObjectRelationshipsCard
            relationships={relationships}
            dataSources={dataSources}
          />
          {/* Created/Updated are Details fields above, so the panel's own
              timestamp footer is left out by omitting its date props. */}
          <ObjectMetadataPanel object={object.object} />
        </>
      )}
    </DetailDrawer>
  );
}
