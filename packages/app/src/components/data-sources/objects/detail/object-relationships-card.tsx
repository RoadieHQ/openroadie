import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Pencil,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import { Button } from '@roadiehq/ui/button';
import {
  isDirectRelationship,
  type ObjectRelationship,
} from '../../../../api/datastore/datastore-client';
import { useQueries } from '@tanstack/react-query';
import { useDatastore } from '../../../../api';
import { objectDetailQuery } from '../../../../api/queries';
import { objectDetail } from '../../../../config/paths';
import { DetailSection } from '../../../common';
import type { DataSourceItem } from '../../types';
import { humanizeRelationshipTypeLabel } from '../../humanize-relationship-type';
import { resolveObjectDisplayName } from '../resolve-object-display-name';
import { useRelationshipRuleNames } from '../../use-relationship-rule-names';

/** Rows shown per box page. */
const BOX_PAGE_SIZE = 5;

interface RelationshipEndpoint {
  datasourceId: string;
  objectId: string;
}

interface RelationshipWithResolvedData extends ObjectRelationship {
  sourceObject?: unknown;
  destinationObject?: unknown;
  sourceObjectData?: unknown;
  destinationObjectData?: unknown;
  sourceResolvedObject?: unknown;
  destinationResolvedObject?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function otherEndpoint(relationship: ObjectRelationship): RelationshipEndpoint {
  return relationship.direction === 'outgoing'
    ? {
        objectId: relationship.destinationObjectId,
        datasourceId: relationship.destinationDatasourceId,
      }
    : {
        objectId: relationship.sourceObjectId,
        datasourceId: relationship.sourceDatasourceId,
      };
}

function objectPayload(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return isRecord(value.object) ? value.object : value;
}

function endpointPayload(relationship: RelationshipWithResolvedData): unknown {
  const isOutgoing = relationship.direction === 'outgoing';
  const payload = isOutgoing
    ? (relationship.destinationObject ??
      relationship.destinationObjectData ??
      relationship.destinationResolvedObject)
    : (relationship.sourceObject ??
      relationship.sourceObjectData ??
      relationship.sourceResolvedObject);

  return objectPayload(payload);
}

function resolveRelationshipTargetName(
  relationship: RelationshipWithResolvedData,
  endpoint: RelationshipEndpoint,
  fetchedNames: Map<string, string>,
): string {
  const objectName = resolveObjectDisplayName(
    endpointPayload(relationship),
    '',
  );
  if (objectName) {
    return objectName;
  }

  if (relationship.direction === 'outgoing') {
    const metadataName = resolveObjectDisplayName(relationship.metadata, '');
    if (metadataName) {
      return metadataName;
    }
  }

  return (
    fetchedNames.get(`${endpoint.datasourceId}:${endpoint.objectId}`) ??
    endpoint.objectId
  );
}

const TARGET_FETCH_CAP = 30;

/**
 * Manual relations carry no target fields, so their names resolve by fetching
 * the target objects. Bounded to the first TARGET_FETCH_CAP unresolved
 * endpoints to keep pathological objects cheap.
 */
function useFetchedTargetNames(
  relationships: RelationshipWithResolvedData[],
): Map<string, string> {
  const api = useDatastore();

  const unresolved = useMemo(() => {
    const seen = new Set<string>();
    const endpoints: Array<{ datasourceId: string; objectId: string }> = [];
    for (const relationship of relationships) {
      const endpoint = otherEndpoint(relationship);
      const hasName =
        resolveObjectDisplayName(endpointPayload(relationship), '') ||
        (relationship.direction === 'outgoing' &&
          resolveObjectDisplayName(relationship.metadata, ''));
      const key = `${endpoint.datasourceId}:${endpoint.objectId}`;
      if (!hasName && !seen.has(key)) {
        seen.add(key);
        endpoints.push({
          datasourceId: endpoint.datasourceId,
          objectId: endpoint.objectId,
        });
      }
    }
    return endpoints.slice(0, TARGET_FETCH_CAP);
  }, [relationships]);

  const results = useQueries({
    queries: unresolved.map(({ datasourceId, objectId }) =>
      objectDetailQuery(api, datasourceId, objectId),
    ),
  });

  return useMemo(() => {
    const names = new Map<string, string>();
    results.forEach((result, index) => {
      const endpoint = unresolved.at(index);
      if (!endpoint || !result.data) {
        return;
      }
      const name = resolveObjectDisplayName(result.data.object, '');
      if (name) {
        names.set(`${endpoint.datasourceId}:${endpoint.objectId}`, name);
      }
    });
    return names;
  }, [results, unresolved]);
}

function provenanceLabel(
  relationship: RelationshipWithResolvedData,
  ruleNames: Map<string, string>,
): string {
  if (isDirectRelationship(relationship)) {
    return 'Direct relationship';
  }
  const ruleId = relationship.ruleId as string;
  return `Rule: ${ruleNames.get(ruleId) ?? ruleId}`;
}

/**
 * The relationship kind as read from this object's side. An incoming edge is
 * stored under its forward type ("owns", asserted on the other object), so
 * when it declares a reciprocal type that is the honest label here
 * ("ownedBy") and it groups with outgoing edges of that type. Incoming edges
 * without one keep the forward type — those rows carry an explicit "incoming"
 * cue instead.
 */
function effectiveKind(relationship: ObjectRelationship): string {
  if (
    relationship.direction === 'incoming' &&
    relationship.reciprocalRelationshipType
  ) {
    return relationship.reciprocalRelationshipType;
  }
  return relationship.relationshipType;
}

function isUnlabeledIncoming(relationship: ObjectRelationship): boolean {
  return (
    relationship.direction === 'incoming' &&
    !relationship.reciprocalRelationshipType
  );
}

function detailEntries(
  relationship: RelationshipWithResolvedData,
  ruleNames: Map<string, string>,
): Array<[string, string]> {
  const entries: Array<[string, string]> = [
    ['type', relationship.relationshipType],
    ['direction', relationship.direction],
    ['source', provenanceLabel(relationship, ruleNames)],
  ];
  if (relationship.reciprocalRelationshipType) {
    entries.push(['reciprocal type', relationship.reciprocalRelationshipType]);
  }
  if (typeof relationship.confidence === 'number') {
    entries.push(['confidence', String(relationship.confidence)]);
  }
  if (relationship.createdAt) {
    entries.push([
      'created',
      new Date(relationship.createdAt).toLocaleDateString(),
    ]);
  }
  for (const [key, value] of Object.entries(relationship.metadata ?? {})) {
    if (value === null || value === undefined || typeof value === 'object') {
      continue;
    }
    // Direct edges created from a rule's editor record the rule id in
    // metadata — resolve it to the rule's name instead of leaking a uuid.
    if (key === 'createdFromRuleId') {
      entries.push([
        'created from rule',
        ruleNames.get(String(value)) ?? String(value),
      ]);
      continue;
    }
    entries.push([key, String(value)]);
  }
  return entries;
}

function RelationshipDetailsPopover({
  relationship,
  ruleNames,
}: {
  relationship: RelationshipWithResolvedData;
  ruleNames: Map<string, string>;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Relationship details"
          className="size-6 shrink-0 text-muted-foreground/60 hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
        >
          <Info />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
          {detailEntries(relationship, ruleNames).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-mono text-2xs text-muted-foreground">
                {key}
              </dt>
              <dd className="min-w-0 truncate text-foreground/90">{value}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** Any direct edge is editable — incoming ones are edited from the source
 * object's side, which the page-level handler routes to. Rule edges never are. */
function isEditableDirectRelationship(
  relationship: ObjectRelationship,
): boolean {
  return isDirectRelationship(relationship);
}

/** One (relationship kind, related datasource) combination. */
function RelationshipBox({
  kindLabel,
  datasourceName,
  rows,
  ruleNames,
  onEditRelationship,
}: {
  kindLabel: string;
  /** Every row in a box shares the related datasource — named once, here. */
  datasourceName: string;
  rows: RelationshipWithResolvedData[];
  ruleNames: Map<string, string>;
  onEditRelationship?: (relationship: ObjectRelationship) => void;
}) {
  // Frontend pagination: the whole edge list is already in memory, each box
  // just windows its own slice.
  const [rawPageIndex, setRawPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / BOX_PAGE_SIZE));
  // Clamp instead of resetting in an effect, so a shrinking list can never
  // strand the box on an empty page.
  const pageIndex = Math.min(rawPageIndex, pageCount - 1);
  const visibleRows = rows.slice(
    pageIndex * BOX_PAGE_SIZE,
    (pageIndex + 1) * BOX_PAGE_SIZE,
  );
  // Resolve names for the visible page only — keeps fetch volume bounded on
  // boxes with hundreds of edges.
  const fetchedNames = useFetchedTargetNames(visibleRows);

  return (
    <div
      role="group"
      aria-label={`${kindLabel} · ${datasourceName}`}
      className="flex min-w-0 flex-col overflow-hidden rounded-md border border-divider"
    >
      <div className="flex items-center justify-between gap-2 border-b border-divider bg-muted/50 px-3 py-2">
        <span className="truncate text-xs font-medium text-foreground">
          {datasourceName}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {rows.length}
        </span>
      </div>
      <ul className="divide-y divide-divider">
        {visibleRows.map(relationship => {
          const endpoint = otherEndpoint(relationship);
          const targetName = resolveRelationshipTargetName(
            relationship,
            endpoint,
            fetchedNames,
          );
          return (
            <li
              key={`${relationship.id}-${relationship.direction}`}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link
                  to={objectDetail(endpoint.datasourceId, endpoint.objectId)}
                  className="motion-colors inline-flex min-w-0 items-center gap-1 text-sm text-foreground hover:underline"
                >
                  <span className="truncate">{targetName}</span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </Link>
                {/* Direct edges carry no row badge — the pencil already marks
                    them and the popover names the provenance. Only the
                    unlabeled-incoming cue earns a second line. */}
                {isUnlabeledIncoming(relationship) && (
                  <span
                    className="text-2xs text-muted-foreground"
                    title="Created from the related object's side; shown under its forward type because no reciprocal type is defined."
                  >
                    incoming
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                {onEditRelationship &&
                  isEditableDirectRelationship(relationship) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Edit direct relationship"
                      className="size-6 shrink-0 text-muted-foreground/60 hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
                      onClick={() => onEditRelationship(relationship)}
                    >
                      <Pencil />
                    </Button>
                  )}
                <RelationshipDetailsPopover
                  relationship={relationship}
                  ruleNames={ruleNames}
                />
              </span>
            </li>
          );
        })}
      </ul>
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-divider bg-muted/20 px-3 py-1">
          <span className="text-2xs text-muted-foreground tabular-nums">
            {pageIndex * BOX_PAGE_SIZE + 1}–
            {Math.min((pageIndex + 1) * BOX_PAGE_SIZE, rows.length)} of{' '}
            {rows.length}
          </span>
          <span className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous page"
              className="size-6 text-muted-foreground/60 hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
              disabled={pageIndex === 0}
              onClick={() => setRawPageIndex(Math.max(0, pageIndex - 1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next page"
              className="size-6 text-muted-foreground/60 hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
              disabled={pageIndex >= pageCount - 1}
              onClick={() =>
                setRawPageIndex(Math.min(pageCount - 1, pageIndex + 1))
              }
            >
              <ChevronRight />
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

interface KindGroup {
  kind: string;
  total: number;
  boxes: Array<{
    datasourceId: string;
    datasourceName: string;
    rows: RelationshipWithResolvedData[];
  }>;
}

export function ObjectRelationshipsCard({
  relationships,
  dataSources,
  onEditRelationship,
}: {
  relationships: ObjectRelationship[];
  dataSources: DataSourceItem[];
  /** Opens the manual-relationship editor for an edge this object owns. */
  onEditRelationship?: (relationship: ObjectRelationship) => void;
}) {
  const dataSourceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const dataSource of dataSources) {
      map.set(dataSource.id, dataSource.name);
    }
    return map;
  }, [dataSources]);

  // Grouped twice: a section per kind (as read from this side), and within it
  // a box per related datasource. Both levels sorted for a stable layout.
  const groups = useMemo<KindGroup[]>(() => {
    const byKind = new Map<
      string,
      Map<string, RelationshipWithResolvedData[]>
    >();
    for (const relationship of relationships as RelationshipWithResolvedData[]) {
      const kind = effectiveKind(relationship);
      const { datasourceId } = otherEndpoint(relationship);
      const kindBucket =
        byKind.get(kind) ?? new Map<string, RelationshipWithResolvedData[]>();
      byKind.set(kind, kindBucket);
      const dsBucket = kindBucket.get(datasourceId);
      if (dsBucket) {
        dsBucket.push(relationship);
      } else {
        kindBucket.set(datasourceId, [relationship]);
      }
    }
    return [...byKind.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, byDatasource]) => {
        const boxes = [...byDatasource.entries()]
          .map(([datasourceId, rows]) => ({
            datasourceId,
            datasourceName: dataSourceNames.get(datasourceId) ?? datasourceId,
            rows,
          }))
          .sort((left, right) =>
            left.datasourceName.localeCompare(right.datasourceName),
          );
        return {
          kind,
          total: boxes.reduce((sum, box) => sum + box.rows.length, 0),
          boxes,
        };
      });
  }, [relationships, dataSourceNames]);

  const ruleNames = useRelationshipRuleNames();

  return (
    // No section heading: the kind headings below carry the structure, and
    // "Relationships" plus a grand total added nothing over them.
    <DetailSection>
      {groups.length === 0 ? (
        <p className="rounded-md border border-divider px-3 py-6 text-center text-sm text-muted-foreground">
          No relationships found for this object.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(group => {
            const kindLabel = humanizeRelationshipTypeLabel(group.kind);
            return (
              <section
                key={group.kind}
                aria-label={kindLabel}
                className="flex flex-col gap-2"
              >
                <div className="flex items-baseline gap-1.5">
                  <h4
                    className="truncate text-sm font-medium text-foreground"
                    title={group.kind}
                  >
                    {kindLabel}
                  </h4>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {group.total}
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {group.boxes.map(box => (
                    <RelationshipBox
                      key={box.datasourceId}
                      kindLabel={kindLabel}
                      datasourceName={box.datasourceName}
                      rows={box.rows}
                      ruleNames={ruleNames}
                      onEditRelationship={onEditRelationship}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </DetailSection>
  );
}
