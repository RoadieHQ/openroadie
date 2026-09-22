import { PaginationFooter } from '@roadiehq/ui/pagination';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { DetailSection, PreviewTable, type PreviewColumn } from '../../common';
import { useDatastore } from '../../../api';
import { queryKeys } from '../../../api/queries';
import type { ContextGroupPreviewGroup } from '../../../api/datastore/datastore-client';
import { contextGroupInstance } from '../../../config/paths';
import { resolveObjectDisplayNameOrNull } from '../../data-sources/objects/resolve-object-display-name';

const INSTANCES_PAGE_SIZE = 10;
const countFormatter = new Intl.NumberFormat();

interface ContextGroupInstanceRow extends ContextGroupPreviewGroup {
  memberCount: number;
  primaryLabel: string | null;
}

const INSTANCE_COLUMNS: PreviewColumn<ContextGroupInstanceRow>[] = [
  {
    key: 'instance',
    header: 'Group',
    className: 'align-middle',
    cell: row => (
      <div className="min-w-0">
        <Link
          to={contextGroupInstance(row.id)}
          className="motion-colors inline-flex min-w-0 items-center gap-1 text-foreground hover:underline"
        >
          <span className="truncate">{row.primaryLabel ?? row.name}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </Link>
        {row.memberCount > 1 ? (
          <p className="truncate text-xs text-muted-foreground">
            +{countFormatter.format(row.memberCount - 1)} more records
          </p>
        ) : null}
      </div>
    ),
  },
  {
    key: 'records',
    header: 'Records',
    className: 'w-28 align-middle',
    cell: row => (
      <span className="text-sm text-surface-foreground">
        {countFormatter.format(row.memberCount)}
      </span>
    ),
  },
];

export function ContextGroupInstancesSection({
  ruleId,
  enabled = true,
  rowNavigation = true,
}: {
  ruleId: string;
  enabled?: boolean;
  /** Whole-row navigation in PreviewTable. Off in the detail drawer where only
   *  the group link should look clickable; on for the full detail page. */
  rowNavigation?: boolean;
}) {
  const datastore = useDatastore();
  const [pageIndex, setPageIndex] = useState(0);
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      ...queryKeys.contextGroupRuleGroups(ruleId),
      'detailPage',
      pageIndex,
    ],
    queryFn: () =>
      datastore.getContextGroupRuleGroups(ruleId, {
        limit: INSTANCES_PAGE_SIZE,
        offset: pageIndex * INSTANCES_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    enabled: enabled && !!ruleId,
  });

  useEffect(() => {
    setPageIndex(0);
  }, [ruleId]);

  const totalGroups = data?.totalGroups ?? 0;
  const pageCount = Math.max(
    1,
    Math.ceil(totalGroups / INSTANCES_PAGE_SIZE) || 1,
  );

  useEffect(() => {
    setPageIndex(current => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const rows = useMemo<ContextGroupInstanceRow[]>(
    () =>
      (data?.groups ?? []).map(group => ({
        ...group,
        memberCount: group.members.length,
        primaryLabel: group.members[0]
          ? (resolveObjectDisplayNameOrNull(
              group.members[0].object,
              group.members[0].presentation,
            ) ?? group.name)
          : null,
      })),
    [data?.groups],
  );

  const showPagination = totalGroups > INSTANCES_PAGE_SIZE;

  return (
    <DetailSection
      title="Groups"
      count={isLoading || isError ? undefined : totalGroups}
    >
      <PreviewTable
        columns={INSTANCE_COLUMNS}
        rows={rows}
        getRowId={row => row.id}
        rowHref={
          rowNavigation ? row => contextGroupInstance(row.id) : undefined
        }
        loading={isLoading}
        skeletonRows={3}
        emptyMessage={
          isError ? 'Failed to load groups.' : 'No groups available yet.'
        }
        className={showPagination ? 'rounded-b-none border-b-0' : undefined}
      />
      {showPagination ? (
        <div className="overflow-hidden rounded-b-md border border-divider bg-muted/20">
          <PaginationFooter
            filteredRowCount={totalGroups}
            pageIndex={pageIndex}
            pageSize={INSTANCES_PAGE_SIZE}
            pageCount={pageCount}
            onPreviousPage={() =>
              setPageIndex(current => Math.max(0, current - 1))
            }
            onNextPage={() =>
              setPageIndex(current => Math.min(pageCount - 1, current + 1))
            }
            canPreviousPage={pageIndex > 0}
            canNextPage={pageIndex < pageCount - 1}
          />
        </div>
      ) : null}
    </DetailSection>
  );
}
