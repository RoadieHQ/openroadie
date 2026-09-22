import { PaginationFooter } from '@roadiehq/ui/pagination';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ExternalLink, Waypoints } from 'lucide-react';
import { DetailSection, PreviewTable, type PreviewColumn } from '../../common';
import {
  dataSourceDetail,
  dataSourceObjects,
  relationshipBetween,
} from '../../../config/paths';
import { humanizeRelationshipTypeLabel } from '../../data-sources/humanize-relationship-type';
import { ViewRelationshipGraphButton } from '../../relationships/view-relationship-graph-button';

const RELATIONSHIP_PAGE_SIZE = 5;

export interface ContextGroupRelationshipRow {
  key: string;
  relationshipType: string;
  source?: { id: string; name: string };
  target?: { id: string; name: string };
  viewable?: boolean;
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

const RELATIONSHIP_COLUMNS: PreviewColumn<ContextGroupRelationshipRow>[] = [
  {
    key: 'type',
    header: 'Relationship',
    className: 'w-1/3 align-middle',
    cell: row => (
      <span
        className="block truncate text-sm font-medium text-surface-foreground"
        title={row.relationshipType}
      >
        {humanizeRelationshipTypeLabel(row.relationshipType)}
      </span>
    ),
  },
  {
    key: 'sources',
    header: 'Sources',
    className: 'align-middle',
    cell: row =>
      row.source && row.target ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <DatasourceLink endpoint={row.source} />
          <ArrowRight
            className="size-3 shrink-0 text-muted-foreground"
            aria-label="to"
          />
          <DatasourceLink endpoint={row.target} />
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  {
    key: 'graph',
    header: '',
    className: 'w-10 align-middle',
    cell: row =>
      row.source && row.target && row.viewable ? (
        <Link
          to={relationshipBetween(row.source.id, row.target.id, row.key)}
          title="View in relationships editor"
          aria-label="View in relationships editor"
          className="motion-colors inline-flex text-muted-foreground hover:text-foreground"
        >
          <Waypoints className="size-4" />
        </Link>
      ) : null,
  },
];

export function ContextGroupRelationshipsSection({
  rows,
  loading,
  graphHref,
}: {
  rows: ContextGroupRelationshipRow[];
  loading: boolean;
  graphHref?: string;
}) {
  const datasetSignature = useMemo(
    () => rows.map(row => row.key).join('|'),
    [rows],
  );
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(
    1,
    Math.ceil(rows.length / RELATIONSHIP_PAGE_SIZE),
  );

  useEffect(() => {
    setPageIndex(0);
  }, [datasetSignature]);

  useEffect(() => {
    setPageIndex(current => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const paginatedRows = rows.slice(
    pageIndex * RELATIONSHIP_PAGE_SIZE,
    (pageIndex + 1) * RELATIONSHIP_PAGE_SIZE,
  );
  const showPagination = rows.length > RELATIONSHIP_PAGE_SIZE;

  return (
    <DetailSection
      title="Merge relationships"
      count={loading ? undefined : rows.length}
      actions={
        graphHref ? (
          <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">
            <ViewRelationshipGraphButton to={graphHref} />
          </div>
        ) : undefined
      }
    >
      <PreviewTable
        columns={RELATIONSHIP_COLUMNS}
        rows={paginatedRows}
        getRowId={row => row.key}
        loading={loading}
        skeletonRows={2}
        emptyMessage="No relationships configured."
        className={showPagination ? 'rounded-b-none border-b-0' : undefined}
      />
      {showPagination ? (
        <div className="overflow-hidden rounded-b-md border border-divider bg-muted/20">
          <PaginationFooter
            filteredRowCount={rows.length}
            pageIndex={pageIndex}
            pageSize={RELATIONSHIP_PAGE_SIZE}
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
