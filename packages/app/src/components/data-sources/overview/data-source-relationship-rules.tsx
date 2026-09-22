import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Waypoints,
} from 'lucide-react';
import { PaginationFooter } from '@roadiehq/ui/pagination';
import { DetailSection, PreviewTable, type PreviewColumn } from '../../common';
import {
  dataSourceDetail,
  dataSourceObjects,
  relationshipBetween,
  relationshipsScoped,
} from '../../../config/paths';
import { humanizeRelationshipTypeLabel } from '../humanize-relationship-type';
import { DirectRelationshipBadge } from '../direct-relationship-badge';
import { RelationshipRuleBadge } from '../relationship-rule-badge';
import type { DataSourceRelationshipRule } from './use-data-source-detail';

const RELATIONSHIP_PAGE_SIZE = 5;

/** The related source's detail (when named) or its objects view. */
function relatedHref(rule: DataSourceRelationshipRule, named: boolean): string {
  return named
    ? dataSourceDetail(rule.relatedDatasourceId)
    : dataSourceObjects(rule.relatedDatasourceId);
}

interface DataSourceRelationshipRulesProps {
  rules: DataSourceRelationshipRule[];
  /** The data source this drawer is for — one endpoint of every rule here. */
  currentDataSourceId: string;
  /** Resolves a related data source id to its display name. */
  nameById: Map<string, string>;
  /** Enabled data source ids — a relationship is only linkable to the editor
   * when both endpoints are enabled (the editor draws only enabled sources). */
  enabledDataSourceIds: ReadonlySet<string>;
  loading: boolean;
}

/**
 * How a data source connects to others in the graph, one row per active rule:
 * the kind of relationship, the source at the other end, and how many links it
 * has produced. Reads for a non-developer — the underlying field expressions
 * stay in the rule editor behind the row.
 */
export function DataSourceRelationshipRules({
  rules,
  currentDataSourceId,
  nameById,
  enabledDataSourceIds,
  loading,
}: DataSourceRelationshipRulesProps) {
  const currentEnabled = enabledDataSourceIds.has(currentDataSourceId);

  // Scope for the whole-neighborhood link: this data source plus every enabled
  // source it relates to. Only offered when there's at least one such pair, so
  // the editor doesn't open on a lone (or empty) node.
  const relatedEnabledIds = Array.from(
    new Set(
      rules
        .map(rule => rule.relatedDatasourceId)
        .filter(id => enabledDataSourceIds.has(id)),
    ),
  );
  const scopeDataSourceIds = currentEnabled
    ? [currentDataSourceId, ...relatedEnabledIds]
    : [];
  const groupLink =
    scopeDataSourceIds.length > 1 ? (
      <Link
        to={relationshipsScoped({ dataSourceIds: scopeDataSourceIds })}
        aria-label="Open in relationships editor"
        title="Open in relationships editor"
        className="motion-colors inline-flex text-muted-foreground hover:text-foreground"
      >
        <Waypoints className="size-4" />
      </Link>
    ) : undefined;

  const datasetSignature = useMemo(
    () => rules.map(rule => rule.id).join('|'),
    [rules],
  );
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(
    1,
    Math.ceil(rules.length / RELATIONSHIP_PAGE_SIZE),
  );

  useEffect(() => {
    setPageIndex(0);
  }, [datasetSignature]);

  useEffect(() => {
    setPageIndex(current => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const paginatedRules = rules.slice(
    pageIndex * RELATIONSHIP_PAGE_SIZE,
    (pageIndex + 1) * RELATIONSHIP_PAGE_SIZE,
  );
  const showPagination = rules.length > RELATIONSHIP_PAGE_SIZE;

  const columns: PreviewColumn<DataSourceRelationshipRule>[] = [
    {
      key: 'relationship',
      header: 'Relationship',
      className: 'align-top',
      cell: rule => (
        // The raw rule name is a field-expression mapping — keep it as a hover
        // hint for the curious, but lead with the human-readable type.
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="truncate font-medium text-foreground"
            title={rule.name}
          >
            {humanizeRelationshipTypeLabel(rule.relationshipType)}
          </span>
          {rule.direct ? (
            <DirectRelationshipBadge />
          ) : (
            <RelationshipRuleBadge ruleName={rule.name} />
          )}
        </span>
      ),
    },
    {
      key: 'relatedSource',
      header: 'Related source',
      className: 'align-top',
      cell: rule => {
        const Icon =
          rule.direction === 'outbound' ? ArrowUpRight : ArrowDownLeft;
        const name = nameById.get(rule.relatedDatasourceId);
        return (
          <span className="flex min-w-0 items-center gap-1">
            <Icon
              className="size-3 shrink-0 text-muted-foreground"
              aria-label={
                rule.direction === 'outbound' ? 'Points to' : 'Referenced by'
              }
            />
            <Link
              to={relatedHref(rule, !!name)}
              className="motion-colors inline-flex min-w-0 items-center gap-1 text-foreground hover:underline"
            >
              <span
                className={name ? 'truncate' : 'truncate text-muted-foreground'}
              >
                {name ?? 'Untitled source'}
              </span>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
            </Link>
          </span>
        );
      },
    },
    {
      key: 'count',
      header: 'Count',
      className: 'w-16 align-top text-right tabular-nums',
      cell: rule => rule.count.toLocaleString(),
    },
    {
      key: 'graph',
      // The column header is the whole-neighborhood link; the cells are the
      // per-relationship links.
      header: groupLink,
      className: 'w-10 align-top',
      // Only linkable when both endpoints are enabled — the editor draws only
      // enabled data sources, so a link to a disabled one lands on an empty
      // canvas. Centers the viewport on this relationship.
      cell: rule =>
        currentEnabled && enabledDataSourceIds.has(rule.relatedDatasourceId) ? (
          <Link
            // Direct rows have no rule to center on — scope to the pair.
            to={
              rule.direct
                ? relationshipsScoped({
                    dataSourceIds: [
                      currentDataSourceId,
                      rule.relatedDatasourceId,
                    ],
                  })
                : relationshipBetween(
                    currentDataSourceId,
                    rule.relatedDatasourceId,
                    rule.id,
                  )
            }
            title="View in relationships editor"
            aria-label="View in relationships editor"
            className="motion-colors inline-flex text-muted-foreground hover:text-foreground"
          >
            <Waypoints className="size-4" />
          </Link>
        ) : null,
    },
  ];

  return (
    <DetailSection
      title="Relationships"
      count={loading ? undefined : rules.length}
    >
      <PreviewTable
        columns={columns}
        rows={paginatedRules}
        getRowId={rule => rule.id}
        loading={loading}
        skeletonRows={2}
        emptyMessage="No relationships yet."
        className={showPagination ? 'rounded-b-none border-b-0' : undefined}
      />
      {showPagination ? (
        <div className="overflow-hidden rounded-b-md border border-divider bg-muted/20">
          <PaginationFooter
            filteredRowCount={rules.length}
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
