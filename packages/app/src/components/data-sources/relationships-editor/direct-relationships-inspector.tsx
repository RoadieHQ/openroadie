import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ExternalLink, Pencil, X } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { PaginationFooter } from '@roadiehq/ui/pagination';
import { Separator } from '@roadiehq/ui/separator';
import type { Relationship } from '../../../api/datastore/datastore-client';
import { useDatastore } from '../../../api';
import { objectDetailQuery } from '../../../api/queries';
import { objectDetail, objectRelationshipEdit } from '../../../config/paths';
import type { DataSourceItem } from '../types';
import { DetailSection } from '../../common';
import { humanizeRelationshipTypeLabel } from '../humanize-relationship-type';
import { resolveObjectDisplayName } from '../objects/resolve-object-display-name';
import { DataSourceCard } from './inspector-shared';

const NAME_FETCH_CAP = 30;
const RELATIONSHIP_PAGE_SIZE = 5;

/** Bounded object-name resolution for the listed endpoints (they arrive as
 * bare ids). Mirrors the object-relationships card's cap so a pathological
 * pair stays cheap. */
function useEndpointNames(
  relationships: ReadonlyArray<Relationship>,
): Map<string, string> {
  const api = useDatastore();
  const endpoints = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ datasourceId: string; objectId: string }> = [];
    for (const rel of relationships) {
      for (const endpoint of [
        {
          datasourceId: rel.sourceDatasourceId,
          objectId: rel.sourceObjectId,
        },
        {
          datasourceId: rel.destinationDatasourceId,
          objectId: rel.destinationObjectId,
        },
      ]) {
        const key = `${endpoint.datasourceId}:${endpoint.objectId}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push(endpoint);
        }
      }
    }
    return list.slice(0, NAME_FETCH_CAP);
  }, [relationships]);

  const results = useQueries({
    queries: endpoints.map(({ datasourceId, objectId }) =>
      objectDetailQuery(api, datasourceId, objectId),
    ),
  });

  return useMemo(() => {
    const names = new Map<string, string>();
    results.forEach((result, index) => {
      const endpoint = endpoints.at(index);
      if (!endpoint || !result.data) {
        return;
      }
      const name = resolveObjectDisplayName(result.data.object, '');
      if (name) {
        names.set(`${endpoint.datasourceId}:${endpoint.objectId}`, name);
      }
    });
    return names;
  }, [results, endpoints]);
}

interface DirectRelationshipsInspectorProps {
  open: boolean;
  sourceDataSource: DataSourceItem | undefined;
  targetDataSource: DataSourceItem | undefined;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  relationships: Relationship[];
  /** Opens the direct-relationship edit drawer in place; when omitted the
   * pencil falls back to navigating to the edge's edit route. */
  onEditRelationship?: (relationship: Relationship) => void;
  onClose: () => void;
}

export function DirectRelationshipsInspector({
  open,
  sourceDataSource,
  targetDataSource,
  sourceDatasourceId,
  targetDatasourceId,
  relationships,
  onEditRelationship,
  onClose,
}: DirectRelationshipsInspectorProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        'motion-panel absolute top-0 right-0 z-overlay flex h-full w-[440px] flex-col border-l border-border bg-card shadow-lg',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
      role="region"
      aria-label="Direct relationships"
      aria-hidden={!open}
      inert={!open}
    >
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            Direct relationships
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 opacity-60 hover:opacity-100"
          title="Close"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <Separator />

      <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 py-4">
        <DataSourceCard
          heading="Source"
          ds={sourceDataSource}
          fallbackId={sourceDatasourceId}
        />
        <div className="flex justify-center text-muted-foreground">
          <ArrowRight className="size-4" />
        </div>
        <DataSourceCard
          heading="Target"
          ds={targetDataSource}
          fallbackId={targetDatasourceId}
        />

        <DetailSection title="Relationships" count={relationships.length}>
          <DirectRelationshipList
            relationships={relationships}
            onEditRelationship={onEditRelationship}
          />
        </DetailSection>
      </div>
    </div>
  );
}

/** The row list for a set of direct edges: resolved endpoint names linking to
 * their object pages, the humanized type, and a per-edge edit link. Reused by
 * the standalone inspector above and the rule inspector's folded section. */
export function DirectRelationshipList({
  relationships,
  onEditRelationship,
}: {
  relationships: Relationship[];
  onEditRelationship?: (relationship: Relationship) => void;
}) {
  const datasetSignature = useMemo(
    () => relationships.map(rel => rel.id).join('|'),
    [relationships],
  );
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(
    1,
    Math.ceil(relationships.length / RELATIONSHIP_PAGE_SIZE),
  );

  useEffect(() => {
    setPageIndex(0);
  }, [datasetSignature]);

  useEffect(() => {
    setPageIndex(current => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const paginatedRelationships = relationships.slice(
    pageIndex * RELATIONSHIP_PAGE_SIZE,
    (pageIndex + 1) * RELATIONSHIP_PAGE_SIZE,
  );
  const showPagination = relationships.length > RELATIONSHIP_PAGE_SIZE;

  // Resolve names for the visible page only.
  const names = useEndpointNames(paginatedRelationships);
  const nameOf = (datasourceId: string, objectId: string) =>
    names.get(`${datasourceId}:${objectId}`) ?? objectId;

  return (
    <div className="flex flex-col gap-1">
      {paginatedRelationships.map(rel => (
        <div
          key={rel.id}
          className="flex items-center gap-2 rounded-lg border border-border bg-accent/50 px-2 py-1.5 text-xs"
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <Link
                to={objectDetail(rel.sourceDatasourceId, rel.sourceObjectId)}
                className="truncate font-medium text-foreground hover:underline"
              >
                {nameOf(rel.sourceDatasourceId, rel.sourceObjectId)}
              </Link>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
              <Link
                to={objectDetail(
                  rel.destinationDatasourceId,
                  rel.destinationObjectId,
                )}
                className="truncate font-medium text-foreground hover:underline"
              >
                {nameOf(rel.destinationDatasourceId, rel.destinationObjectId)}
              </Link>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
            </div>
            <div className="mt-0.5 truncate text-2xs text-muted-foreground">
              {humanizeRelationshipTypeLabel(rel.relationshipType)}
            </div>
          </div>
          {onEditRelationship ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Edit direct relationship"
              className="size-6 shrink-0 text-muted-foreground/60 hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
              onClick={() => onEditRelationship(rel)}
            >
              <Pencil />
            </Button>
          ) : (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground/60 hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
            >
              <Link
                to={objectRelationshipEdit(
                  rel.sourceDatasourceId,
                  rel.sourceObjectId,
                  rel.id,
                )}
                aria-label="Edit direct relationship"
              >
                <Pencil />
              </Link>
            </Button>
          )}
        </div>
      ))}
      {showPagination ? (
        <div className="overflow-hidden rounded-md border border-divider bg-muted/20">
          <PaginationFooter
            filteredRowCount={relationships.length}
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
    </div>
  );
}
