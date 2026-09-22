import { PaginationFooter } from '@roadiehq/ui/pagination';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Plus } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { DetailSection, PreviewTable, type PreviewColumn } from '../../common';
import { OverviewStatusCell } from '../../overview';
import { dataSourceDetail, dataSourceObjects } from '../../../config/paths';
import type { DatasourceFilter } from '../types';
import type { ContextGroupDatasourceStatus } from '../../../api/datastore/datastore-client';
import { getContextGroupDatasourceStatus } from '../datasource-status';

const DATASOURCE_PAGE_SIZE = 5;

function datasourceLabel(filter: DatasourceFilter): string {
  return (
    filter.status?.displayName ??
    filter.seedName ??
    filter.datasourceId ??
    'Unknown source'
  );
}

type DatasourceRow = DatasourceFilter & {
  key: string;
  originalIndex: number;
};

function datasourceStatusRank(filter: DatasourceFilter): number {
  if (filter.status?.live) {
    return 0;
  }
  if (filter.status) {
    return 1;
  }
  return 2;
}

function compareDatasourceRows(a: DatasourceRow, b: DatasourceRow): number {
  const rankDiff = datasourceStatusRank(a) - datasourceStatusRank(b);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  const labelDiff = datasourceLabel(a).localeCompare(
    datasourceLabel(b),
    undefined,
    {
      sensitivity: 'base',
    },
  );
  if (labelDiff !== 0) {
    return labelDiff;
  }

  return a.originalIndex - b.originalIndex;
}

function DatasourceStatusBadge({
  status,
}: {
  status: ContextGroupDatasourceStatus;
}) {
  const display = getContextGroupDatasourceStatus(status);
  return (
    <OverviewStatusCell
      expanded
      tone={display.tone}
      label={display.label}
      tooltip={display.tooltip}
    />
  );
}

function DatasourceLink({
  endpoint,
}: {
  endpoint: { id: string; name: string };
}) {
  return (
    <Link
      to={
        endpoint.name
          ? dataSourceDetail(endpoint.id)
          : dataSourceObjects(endpoint.id)
      }
      className="motion-colors inline-flex min-w-0 items-center gap-1 text-foreground hover:underline"
    >
      <span className="truncate">{endpoint.name || 'Untitled source'}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </Link>
  );
}

const DATASOURCE_COLUMNS: PreviewColumn<DatasourceRow>[] = [
  {
    key: 'name',
    header: 'Name',
    className: 'align-middle',
    cell: filter => {
      const label = datasourceLabel(filter);
      if (!filter.datasourceId) {
        return (
          <span
            className="block truncate text-sm text-surface-foreground"
            title={label}
          >
            {label}
          </span>
        );
      }
      return (
        <DatasourceLink endpoint={{ id: filter.datasourceId, name: label }} />
      );
    },
  },
  {
    key: 'status',
    header: 'Status',
    className: 'w-1/3 align-middle',
    cell: filter => {
      const status = filter.status;
      if (!status) {
        return <span className="text-xs text-muted-foreground">—</span>;
      }
      return <DatasourceStatusBadge status={status} />;
    },
  },
];

export function DatasourcePreview({
  title,
  filters,
  editHref,
}: {
  title: string;
  filters: DatasourceFilter[];
  editHref?: string;
}) {
  const rows = useMemo(
    () =>
      filters
        .map((filter, index) => ({
          ...filter,
          key: `${index}`,
          originalIndex: index,
        }))
        .sort(compareDatasourceRows),
    [filters],
  );
  const datasetSignature = useMemo(
    () =>
      filters
        .map(filter =>
          [
            filter.datasourceId ?? '',
            filter.seedName ?? '',
            filter.status?.displayName ?? '',
            filter.status?.live ? '1' : '0',
          ].join(':'),
        )
        .join('|'),
    [filters],
  );
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / DATASOURCE_PAGE_SIZE));

  useEffect(() => {
    setPageIndex(0);
  }, [datasetSignature]);

  useEffect(() => {
    setPageIndex(current => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const paginatedRows = rows.slice(
    pageIndex * DATASOURCE_PAGE_SIZE,
    (pageIndex + 1) * DATASOURCE_PAGE_SIZE,
  );
  const showPagination = rows.length > DATASOURCE_PAGE_SIZE;

  return (
    <DetailSection
      title={title}
      count={filters.length}
      actions={
        editHref ? (
          <Button variant="outline" size="sm" asChild>
            <Link to={editHref}>
              <Plus />
              Add
            </Link>
          </Button>
        ) : undefined
      }
    >
      <PreviewTable
        columns={DATASOURCE_COLUMNS}
        rows={paginatedRows}
        getRowId={row => row.key}
        skeletonRows={2}
        emptyMessage="None configured."
        className={showPagination ? 'rounded-b-none border-b-0' : undefined}
      />
      {showPagination ? (
        <div className="overflow-hidden rounded-b-md border border-divider bg-muted/20">
          <PaginationFooter
            filteredRowCount={rows.length}
            pageIndex={pageIndex}
            pageSize={DATASOURCE_PAGE_SIZE}
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
