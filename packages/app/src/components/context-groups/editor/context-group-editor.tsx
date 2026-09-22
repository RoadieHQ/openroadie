import {
  Fragment,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useParams, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { isValidSlug } from '@roadiehq/scopes-common';
import {
  UnreferenceableSlugIcon,
  slugTriggerTooltip,
} from '../../capabilities/unreferenceable-slug';
import { useReferenceRename } from '../../capabilities/use-reference-rename';
import {
  Plus,
  X,
  Eye,
  Loader2,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  ChevronDown,
  Maximize2,
  ArrowRight,
  Hash,
  Star,
  Undo2,
} from 'lucide-react';
import {
  countTokenRange,
  formatTokenRange,
  type TokenRange,
} from './token-counter';
import { Button } from '@roadiehq/ui/button';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { Input } from '@roadiehq/ui/input';
import { Label } from '@roadiehq/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { Checkbox } from '@roadiehq/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roadiehq/ui/table';
import { Spinner } from '@roadiehq/ui/spinner';
import { Separator } from '@roadiehq/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@roadiehq/ui/tabs';
import { cn } from '@roadiehq/ui/utils';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@roadiehq/ui/form';
import { slugify } from '@roadiehq/actions-common';
import { useAlert, useDatastore } from '../../../api';
import {
  contextGroupViewsQuery,
  queryKeys,
  relationshipRulesQuery,
} from '../../../api/queries';
import { workspaceQueryKey } from '../../../api/workspace-scope';
import {
  ErrorBoundary,
  useZodForm,
  useEditorDraft,
  workspaceEditorDraftKey,
  EntityEditorHeader,
  EntityEditorShell,
  resolveContextGroupPageTitle,
} from '../../common';
import { relationshipsScoped } from '../../../config/paths';
import { ViewRelationshipGraphButton } from '../../relationships/view-relationship-graph-button';
import { useContextGroupRule } from '../use-context-groups';
import { useDataSources } from '../../data-sources/use-data-sources';
import { DataSourcePicker } from '../../data-sources/data-source-picker';
import { humanizeRelationshipTypeLabel } from '../../data-sources/humanize-relationship-type';
import { resolveObjectDisplayNameOrNull } from '../../data-sources/objects/resolve-object-display-name';
import type {
  Annotation,
  ProjectionValue,
  DatasourceFilter,
  ContextGroupPreviewGroup,
  ContextGroupPreviewMember,
  ContextGroupDatasourceStatus,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import {
  parseFilterConditions,
  serializeFilterConditions,
} from '@roadiehq/catalog-datastore-common';
import { DatasourceFilterEditor } from './datasource-filter-editor';
import { FullBundleDrawer } from './full-bundle-drawer';
import { ViewPane } from './view-pane';
import { buildBundlePreviewJson } from './projection-utils';

// Reuse the data source editor's JSON viewer; lazy so react-json-view only
// loads when a preview row is actually expanded.
const SchemaViewer = lazy(() =>
  import('../../data-sources/data-source-editor/schema-viewer').then(
    module => ({ default: module.SchemaViewer }),
  ),
);

// Page size for the saved "Groups" view. Matches the backend default so the
// first page needs no extra round-trips.
const GROUPS_PAGE_SIZE = 50;

interface DatasourceOption {
  id: string;
  name: string;
  logoUrl?: string;
  enabled: boolean;
}

interface DatasourceEntry {
  datasourceId?: string;
  seedName?: string;
  status?: ContextGroupDatasourceStatus;
  /** Serialized `FilterCondition[]`; may hold blank draft rows while editing. */
  filter?: string;
  projection?: ProjectionValue;
  annotation?: Annotation;
}

/** True when an annotation carries any content worth persisting. */
function annotationHasContent(annotation?: Annotation): boolean {
  return Boolean(
    annotation && (annotation.title.trim() || annotation.text.trim()),
  );
}

/** Whether a projection (include or exclude, or the legacy array) carries
 *  content worth persisting/showing. */
function hasProjectionContent(projection?: ProjectionValue): boolean {
  if (!projection) return false;
  if (Array.isArray(projection)) return projection.length > 0;
  if (projection.mode === 'exclude') return projection.paths.length > 0;
  return projection.fields.length > 0;
}

/** An entry's filter with blank draft rows stripped, or undefined when no
 *  complete condition remains. */
function cleanEntryFilter(entry: DatasourceEntry): string | undefined {
  return serializeFilterConditions(parseFilterConditions(entry.filter));
}

/** Build the persisted `DatasourceFilter` for a selected entry, including its
 *  filter/projection/annotation only when they carry content. */
function entryToFilter(entry: DatasourceEntry): DatasourceFilter {
  const filter = cleanEntryFilter(entry);
  return {
    ...(entryDatasourceId(entry)
      ? { datasourceId: entryDatasourceId(entry) }
      : {}),
    ...(entry.seedName ? { seedName: entry.seedName } : {}),
    ...(filter ? { filter } : {}),
    ...(hasProjectionContent(entry.projection)
      ? { projection: entry.projection }
      : {}),
    ...(annotationHasContent(entry.annotation)
      ? { annotation: entry.annotation }
      : {}),
  };
}

function entryDatasourceId(entry: DatasourceEntry): string {
  return entry.datasourceId || entry.status?.datasourceId || '';
}

function entryLabel(entry: DatasourceEntry, datasources: DatasourceOption[]) {
  const datasourceId = entryDatasourceId(entry);
  return (
    entry.status?.displayName ??
    datasources.find(ds => ds.id === datasourceId)?.name ??
    entry.seedName ??
    datasourceId ??
    'Unknown data source'
  );
}

function entryInactiveReason(
  entry: DatasourceEntry,
  datasources: DatasourceOption[],
): string | undefined {
  if (entry.status?.live === false) {
    return entry.status.inactiveReason ?? 'Unavailable';
  }
  const datasourceId = entryDatasourceId(entry);
  const datasource = datasources.find(ds => ds.id === datasourceId);
  if (datasource && !datasource.enabled) {
    return 'Data source disabled';
  }
  return undefined;
}

const contextGroupFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  // Optional — blank means "derive one from the name". A non-empty slug must
  // match the grammar, or it can never appear in a `@context-group:<slug>`
  // token nor be a service-token scope target.
  slug: z
    .string()
    .trim()
    .refine(
      value => value === '' || isValidSlug(value),
      'Use lowercase letters, numbers and hyphens',
    ),
  description: z.string().trim(),
});

/** Placeholder shown in the editable header title before the group is named. */
const UNTITLED_CONTEXT_GROUP_LABEL = 'Untitled context group';

/** Tab value for the main settings pane; view tabs use view ids. */
const SETTINGS_TAB = 'settings';
/** Tab value for the transient "New view" draft pane. */
const NEW_VIEW_TAB = 'new-view';

/** The editors' underline tab look (same restyle as the pipeline editors'
 *  `DetailTabBar`), applied to the header tab strip's triggers. */
const EDITOR_TAB_TRIGGER_CLASS = cn(
  'motion-colors relative h-auto min-h-[40px] rounded-none border-0 bg-transparent px-3 py-2 text-sm font-medium text-muted-foreground shadow-none',
  'hover:text-foreground',
  'data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
  "after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-transparent after:content-['']",
  'data-[state=active]:after:bg-primary',
);

function DatasourceEntryRow({
  entry,
  datasources,
  selectedDatasourceIds,
  onUpdate,
  onRemove,
  inactiveReason,
}: {
  entry: DatasourceEntry;
  datasources: DatasourceOption[];
  selectedDatasourceIds: string[];
  onUpdate: (update: Partial<DatasourceEntry>) => void;
  onRemove: () => void;
  inactiveReason?: string;
}) {
  const currentDatasourceId = entryDatasourceId(entry);
  const showPicker = currentDatasourceId || !entry.seedName;
  const availableDatasources = useMemo(
    () =>
      datasources.filter(
        ds =>
          ds.id === currentDatasourceId ||
          (ds.enabled && !selectedDatasourceIds.includes(ds.id)),
      ),
    [datasources, selectedDatasourceIds, currentDatasourceId],
  );

  return (
    <div
      className={`rounded-lg border border-border bg-card ${inactiveReason ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {showPicker ? (
              <DataSourcePicker
                value={currentDatasourceId}
                onChange={value => {
                  onUpdate({
                    datasourceId: value,
                    seedName: undefined,
                    status: undefined,
                  });
                }}
                dataSources={availableDatasources}
                placeholder="Select datasource"
                ariaLabel="Select datasource"
              />
            ) : (
              <div className="truncate rounded-md border border-input bg-background px-3 py-2 text-sm">
                {entryLabel(entry, datasources)}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={`Remove ${entryLabel(entry, datasources)}`}
          >
            <X className="size-4" />
          </Button>
        </div>
        {inactiveReason && (
          <p className="text-xs text-muted-foreground">{inactiveReason}</p>
        )}
        <DatasourceFilterEditor
          datasourceId={currentDatasourceId}
          datasourceName={entryLabel(entry, datasources)}
          filter={entry.filter}
          onChange={filter => onUpdate({ filter })}
        />
      </div>
    </div>
  );
}

function DatasourceSelector({
  entries,
  onChange,
  datasources,
}: {
  entries: DatasourceEntry[];
  onChange: (entries: DatasourceEntry[]) => void;
  datasources: DatasourceOption[];
}) {
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const addEntry = () => {
    onChange([...entries, { datasourceId: '' }]);
  };

  const updateEntry = (index: number, update: Partial<DatasourceEntry>) => {
    onChange(entries.map((e, i) => (i === index ? { ...e, ...update } : e)));
  };

  const removeEntry = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  const selectedDatasourceIds = useMemo(
    () => entries.map(entryDatasourceId).filter(Boolean),
    [entries],
  );

  const entryRows = useMemo(
    () =>
      entries.map((entry, index) => ({
        entry,
        index,
        inactiveReason: entryInactiveReason(entry, datasources),
      })),
    [entries, datasources],
  );
  const activeRows = entryRows.filter(row => !row.inactiveReason);
  const inactiveRows = entryRows.filter(row => row.inactiveReason);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Data Sources</Label>
        <Button type="button" variant="ghost" size="sm" onClick={addEntry}>
          <Plus className="size-4" />
          Add
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No datasources selected</p>
      ) : (
        <div className="space-y-2">
          {activeRows.map(({ entry, index }) => (
            <DatasourceEntryRow
              key={index}
              entry={entry}
              datasources={datasources}
              selectedDatasourceIds={selectedDatasourceIds}
              onUpdate={update => updateEntry(index, update)}
              onRemove={() => removeEntry(index)}
            />
          ))}
          {inactiveRows.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/30">
              <Button
                type="button"
                variant="ghost"
                className="flex h-auto w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                onClick={() => setInactiveOpen(open => !open)}
              >
                {inactiveOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                Unavailable ({inactiveRows.length})
              </Button>
              {inactiveOpen && (
                <div className="space-y-2 border-t border-border p-2">
                  {inactiveRows.map(({ entry, index, inactiveReason }) => (
                    <DatasourceEntryRow
                      key={index}
                      entry={entry}
                      datasources={datasources}
                      selectedDatasourceIds={selectedDatasourceIds}
                      inactiveReason={inactiveReason}
                      onUpdate={update => updateEntry(index, update)}
                      onRemove={() => removeEntry(index)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RelationshipPair {
  sourceId: string;
  targetId: string;
  types: string[];
}

function MergeRelationshipTypesSelector({
  selectedTypes,
  onChange,
  availableRules,
  selectedDatasourceIds,
  datasources,
}: {
  selectedTypes: string[];
  onChange: (types: string[]) => void;
  availableRules: RelationshipRule[];
  selectedDatasourceIds: string[];
  datasources: DatasourceOption[];
}) {
  const nameOf = (id: string) => datasources.find(d => d.id === id)?.name ?? id;

  // Group the relationship rules that connect two selected datasources by their
  // directed pair, so each linkage is shown where it applies — and multiple
  // links between the same two sources sit together.
  const pairs = useMemo<RelationshipPair[]>(() => {
    if (selectedDatasourceIds.length < 2) return [];
    const dsSet = new Set(selectedDatasourceIds);
    const byPair = new Map<string, RelationshipPair>();
    for (const rule of availableRules) {
      if (
        rule.state !== 'active' ||
        !dsSet.has(rule.sourceDatasourceId) ||
        !dsSet.has(rule.targetDatasourceId)
      ) {
        continue;
      }
      const key = `${rule.sourceDatasourceId}:${rule.targetDatasourceId}`;
      let pair = byPair.get(key);
      if (!pair) {
        pair = {
          sourceId: rule.sourceDatasourceId,
          targetId: rule.targetDatasourceId,
          types: [],
        };
        byPair.set(key, pair);
      }
      if (!pair.types.includes(rule.relationshipType)) {
        pair.types.push(rule.relationshipType);
      }
    }
    const list = [...byPair.values()];
    for (const pair of list) pair.types.sort();
    list.sort(
      (a, b) =>
        nameOf(a.sourceId).localeCompare(nameOf(b.sourceId)) ||
        nameOf(a.targetId).localeCompare(nameOf(b.targetId)),
    );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameOf reads `datasources`, which is a dep
  }, [availableRules, selectedDatasourceIds, datasources]);

  const allTypes = useMemo(
    () => [...new Set(pairs.flatMap(p => p.types))],
    [pairs],
  );
  const allSelected =
    allTypes.length > 0 && allTypes.every(t => selectedTypes.includes(t));

  const toggleType = (type: string) => {
    onChange(
      selectedTypes.includes(type)
        ? selectedTypes.filter(t => t !== type)
        : [...selectedTypes, type],
    );
  };

  const toggleAll = () => {
    onChange(
      allSelected
        ? selectedTypes.filter(t => !allTypes.includes(t))
        : [...new Set([...selectedTypes, ...allTypes])],
    );
  };

  if (selectedDatasourceIds.length < 2) {
    return (
      <div className="space-y-2">
        <Label>Merging</Label>
        <p className="text-sm text-muted-foreground">
          Select at least two data sources to merge related records into one
          group.
        </p>
      </div>
    );
  }

  if (pairs.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Merging</Label>
        <p className="text-sm text-muted-foreground">
          No relationships exist between the selected data sources yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Merging</Label>
        <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
          {allSelected ? 'Clear all' : 'Select all'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Records connected by a selected relationship are merged into one group,
        transitively.
      </p>
      <div className="space-y-2">
        {pairs.map(pair => (
          <div
            key={`${pair.sourceId}-${pair.targetId}`}
            className="rounded-lg border border-border"
          >
            <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5 text-xs font-medium">
              <span className="truncate">{nameOf(pair.sourceId)}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{nameOf(pair.targetId)}</span>
              {pair.types.length > 1 && (
                <span className="ml-auto shrink-0 text-[10px] font-normal text-muted-foreground">
                  {pair.types.length} links
                </span>
              )}
            </div>
            <div className="space-y-1 p-2">
              {pair.types.map(type => {
                const id = `merge-${pair.sourceId}-${pair.targetId}-${type}`;
                return (
                  <div key={type} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={selectedTypes.includes(type)}
                      onCheckedChange={() => toggleType(type)}
                      aria-label={`Merge records related by ${type}`}
                    />
                    <Label
                      htmlFor={id}
                      className="flex-1 cursor-pointer text-sm font-normal"
                    >
                      {humanizeRelationshipTypeLabel(type)}
                    </Label>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {type}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RuleAnnotationsEditor({
  annotations,
  onChange,
}: {
  annotations: Annotation[];
  onChange: (annotations: Annotation[]) => void;
}) {
  const update = (i: number, patch: Partial<Annotation>) =>
    onChange(annotations.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const add = () => onChange([...annotations, { title: '', text: '' }]);
  const remove = (i: number) => onChange(annotations.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Annotations</Label>
        <Button type="button" variant="ghost" size="sm" onClick={add}>
          <Plus className="size-4" />
          Add annotation
        </Button>
      </div>
      {annotations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Optional instructions telling the agent how to interpret this bundle.
        </p>
      ) : (
        <div className="space-y-3">
          {annotations.map((annotation, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border border-border bg-card p-2"
              style={{ '--field-bg': 'var(--color-card)' } as CSSProperties}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Annotation {i + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(i)}
                  aria-label={`Remove annotation ${i + 1}`}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <OutlinedInput
                label="Title"
                value={annotation.title}
                onChange={e => update(i, { title: e.target.value })}
                aria-label={`Annotation ${i + 1} title`}
              />
              <OutlinedInput
                label="Instruction"
                value={annotation.text}
                onChange={e => update(i, { text: e.target.value })}
                aria-label={`Annotation ${i + 1} text`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DatasourceColumn {
  id: string;
  name: string;
}

/** The bundle for a materialized group rendered through the rule's default
 *  view — exactly what an agent receives when it doesn't request a
 *  named view. */
function RenderedViewPreview({ groupId }: { groupId: string }) {
  const datastore = useDatastore();
  const { data, isLoading, error } = useQuery({
    queryKey: workspaceQueryKey('contextGroups', 'renderedBundle', groupId),
    queryFn: () => datastore.getRenderedContextGroupBundle(groupId),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-24 items-center justify-center">
        <Spinner size={16} />
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {error instanceof Error ? error.message : 'Failed to render view'}
      </p>
    );
  }
  return (
    <pre className="max-h-96 overflow-auto rounded-md border border-border bg-card p-3 text-xs whitespace-pre-wrap">
      {data?.rendered}
    </pre>
  );
}

function PreviewTable({
  groups,
  totalGroups,
  offset,
  loading,
  datasources,
  datasourceIds,
  projectionByDatasourceId,
  annotationByDatasourceId,
  annotations,
  ruleName,
  onSeeFullBundle,
  renderExpanded,
  expandedLabel,
}: {
  groups: ContextGroupPreviewGroup[];
  totalGroups: number;
  offset: number;
  loading: boolean;
  datasources: DatasourceOption[];
  datasourceIds: string[];
  projectionByDatasourceId: Map<string, ProjectionValue>;
  annotationByDatasourceId: Map<string, Annotation>;
  annotations: Annotation[];
  ruleName: string;
  /** When provided (saved, materialized groups), each row can open the real
   *  bundle for that group. Absent for the unsaved live preview. */
  onSeeFullBundle?: (groupId: string, groupName: string) => void;
  /** Overrides the expanded row's content (e.g. rendering the group through
   *  a view template being edited). */
  renderExpanded?: (group: ContextGroupPreviewGroup) => ReactNode;
  /** Label above the expanded row's content. */
  expandedLabel?: string;
}) {
  // Keyed by the stable group id (not row index) so expansion state doesn't
  // leak onto a different group when the page changes.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const columns = useMemo<DatasourceColumn[]>(() => {
    const getDsName = (dsId: string) =>
      datasources.find(ds => ds.id === dsId)?.name ?? dsId;

    return datasourceIds
      .filter(Boolean)
      .map(dsId => ({ id: dsId, name: getDsName(dsId) }));
  }, [datasources, datasourceIds]);

  const getMembersForDatasource = (
    group: ContextGroupPreviewGroup,
    dsId: string,
  ): ContextGroupPreviewMember[] =>
    group.members.filter(m => m.datasourceId === dsId);

  const getMemberLabel = (
    member: ContextGroupPreviewMember,
    fallbackLabel?: string,
  ) =>
    resolveObjectDisplayNameOrNull(member.object, member.presentation) ??
    fallbackLabel ??
    member.objectId;

  const getGroupLabel = (group: ContextGroupPreviewGroup) =>
    group.members[0]
      ? getMemberLabel(group.members[0], group.name)
      : group.name;

  const buildGroupJson = (group: ContextGroupPreviewGroup) =>
    buildBundlePreviewJson({
      group,
      columns,
      projectionByDatasourceId,
      annotationByDatasourceId,
      annotations,
      ruleName,
    });

  const [tokenRanges, setTokenRanges] = useState<(TokenRange | null)[]>([]);

  useEffect(() => {
    if (groups.length === 0) {
      setTokenRanges([]);
      return;
    }

    setTokenRanges(new Array(groups.length).fill(null));

    let cancelled = false;
    const computeTokens = async () => {
      for (let i = 0; i < groups.length; i++) {
        if (cancelled) break;
        const json = buildGroupJson(groups[`${i}`]);
        const text = JSON.stringify(json);
        const range = countTokenRange(text);
        if (!cancelled) {
          setTokenRanges(prev => prev.map((r, j) => (j === i ? range : r)));
        }
        if (i % 5 === 4) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
    };

    computeTokens();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildGroupJson uses columns, projectionByDatasourceId, annotationByDatasourceId, annotations, ruleName which are listed
  }, [
    groups,
    columns,
    projectionByDatasourceId,
    annotationByDatasourceId,
    annotations,
    ruleName,
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="motion-icon-spin size-6 text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Computing preview...
        </span>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No groups to preview. Make sure you have data sources with objects.
      </p>
    );
  }

  if (columns.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Select datasources to see the preview table.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="pb-2 text-sm text-muted-foreground">
        Showing {groups.length === 0 ? 0 : offset + 1}–{offset + groups.length}{' '}
        of {totalGroups} groups
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                {columns.map(col => (
                  <TableHead key={col.id}>{col.name}</TableHead>
                ))}
                <TableHead className="text-right">
                  <Tooltip>
                    <TooltipTrigger className="ml-auto flex items-center gap-1">
                      Context bundle size (tokens)
                      <span className="text-muted-foreground">~</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Approximate token range across GPT-4, GPT-4o, and other
                      LLM tokenizers
                    </TooltipContent>
                  </Tooltip>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group, idx) => {
                const isExpanded = expandedRows.has(group.id);
                // Expansion is keyed by the stable group id; tokenRanges is a
                // per-page array recomputed on every `groups` change, so it
                // stays index-addressed.
                return (
                  <Fragment key={group.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => toggleRow(group.id)}
                    >
                      <TableCell className="w-10 p-2">
                        <ChevronRight
                          className={`motion-transform size-4 text-muted-foreground ${isExpanded ? 'rotate-90' : ''}`}
                        />
                      </TableCell>
                      {columns.map(col => {
                        const members = getMembersForDatasource(group, col.id);
                        return (
                          <TableCell key={col.id}>
                            {members.length === 0 ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              <div className="space-y-0.5">
                                {members.map((m, i) => (
                                  <div key={i} className="truncate text-sm">
                                    {getMemberLabel(m, group.name)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right">
                        {(() => {
                          const range = tokenRanges[`${idx}`];
                          if (!range) {
                            return (
                              <span className="text-sm text-muted-foreground">
                                ...
                              </span>
                            );
                          }
                          return (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-sm tabular-nums">
                                {formatTokenRange(range)}
                              </span>
                              {range.isHigh && (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <AlertTriangle className="size-4 text-warning" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    High token count may exceed LLM context
                                    limits
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length + 2}
                          className="bg-muted/50 p-3"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">
                              {expandedLabel ??
                                (onSeeFullBundle
                                  ? 'Default view'
                                  : 'Projected preview (unsaved)')}
                            </span>
                            {onSeeFullBundle && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  onSeeFullBundle(
                                    group.id,
                                    getGroupLabel(group),
                                  )
                                }
                              >
                                <Maximize2 className="size-4" />
                                See full bundle
                              </Button>
                            )}
                          </div>
                          {renderExpanded ? (
                            renderExpanded(group)
                          ) : onSeeFullBundle ? (
                            <RenderedViewPreview groupId={group.id} />
                          ) : (
                            <Suspense
                              fallback={
                                <div className="flex min-h-24 items-center justify-center">
                                  <Spinner size={16} />
                                </div>
                              }
                            >
                              <SchemaViewer
                                output={[buildGroupJson(group)]}
                                maxHeight={384}
                              />
                            </Suspense>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TooltipProvider>
      </div>
    </div>
  );
}

function GroupsPagination({
  offset,
  pageCount,
  totalGroups,
  loading,
  onOffsetChange,
}: {
  offset: number;
  pageCount: number;
  totalGroups: number;
  loading: boolean;
  onOffsetChange: (offset: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalGroups / GROUPS_PAGE_SIZE));
  const currentPage = Math.floor(offset / GROUPS_PAGE_SIZE) + 1;

  return (
    <div className="flex items-center justify-between pt-3">
      <Button
        variant="outline"
        size="sm"
        disabled={offset === 0 || loading}
        onClick={() => onOffsetChange(Math.max(0, offset - GROUPS_PAGE_SIZE))}
      >
        <ChevronLeft className="size-4" />
        Previous
      </Button>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {totalGroups === 0 ? 0 : offset + 1}–{offset + pageCount} of{' '}
          {totalGroups}
        </span>
        <div className="flex items-center gap-1.5">
          <span>Page</span>
          <Select
            value={String(currentPage)}
            onValueChange={value =>
              onOffsetChange((Number(value) - 1) * GROUPS_PAGE_SIZE)
            }
            disabled={loading}
          >
            <SelectTrigger className="h-7 w-auto gap-1 px-2 tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <SelectItem
                  key={page}
                  value={String(page)}
                  className="tabular-nums"
                >
                  {page}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>of {totalPages}</span>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={offset + GROUPS_PAGE_SIZE >= totalGroups || loading}
        onClick={() => onOffsetChange(offset + GROUPS_PAGE_SIZE)}
      >
        Next
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

/** The right-hand groups preview column shared by the settings tab and the
 *  view tabs: header with the group count, the preview table, and
 *  optional pagination. */
function GroupsPreviewColumn({
  pagination,
  ...tableProps
}: ComponentProps<typeof PreviewTable> & { pagination?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 pb-4">
        <Eye className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          Preview ({tableProps.totalGroups}{' '}
          {tableProps.totalGroups === 1 ? 'group' : 'groups'})
        </h2>
      </div>
      <ErrorBoundary>
        <PreviewTable {...tableProps} />
      </ErrorBoundary>
      {pagination}
    </div>
  );
}

const NO_RELATIONSHIP_RULES: RelationshipRule[] = [];

function useRelationshipRules() {
  const datastore = useDatastore();
  const { data, isLoading } = useQuery(relationshipRulesQuery(datastore, 1000));

  return { rules: data?.items ?? NO_RELATIONSHIP_RULES, loading: isLoading };
}

function useStoredGroups(
  ruleId: string | undefined,
  offset: number,
  limit: number,
) {
  const datastore = useDatastore();
  const { data, isLoading } = useQuery({
    queryKey: [
      ...queryKeys.contextGroupRuleGroups(ruleId ?? ''),
      { offset, limit },
    ],
    queryFn: () =>
      datastore.getContextGroupRuleGroups(ruleId ?? '', { limit, offset }),
    enabled: !!ruleId && ruleId !== 'new',
    // Keep the current page's rows visible while the next page loads.
    placeholderData: keepPreviousData,
  });

  return { groups: data ?? null, loading: isLoading };
}

const EMPTY_PREVIEW_INPUT = {
  datasources: [] as DatasourceFilter[],
  mergeRelationshipTypes: [] as string[],
};

function usePreview(
  datasources: DatasourceFilter[],
  mergeRelationshipTypes: string[],
  enabled: boolean,
) {
  const datastore = useDatastore();
  const input = useMemo(
    () => ({
      datasources,
      mergeRelationshipTypes,
    }),
    [datasources, mergeRelationshipTypes],
  );

  // Debounce the key input (UI state): edits must settle for 500ms before a
  // preview is computed. Starts empty so even the first fetch waits out the
  // debounce, matching the previous behavior.
  const [debouncedInput, setDebouncedInput] = useState(EMPTY_PREVIEW_INPUT);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInput(input), 500);
    return () => clearTimeout(timer);
  }, [input]);

  const active = enabled && datasources.length > 0;
  const { data, isFetching } = useQuery({
    queryKey: workspaceQueryKey('contextGroups', 'preview', debouncedInput),
    queryFn: () => datastore.previewContextGroupRule(debouncedInput),
    enabled: active && debouncedInput.datasources.length > 0,
  });

  // Loading covers the debounce window too (debounced copy lagging the live
  // input), preserving the immediate "Computing preview..." feedback.
  const loading = active && (input !== debouncedInput || isFetching);

  return { preview: active ? (data ?? null) : null, loading };
}

interface DraftFields {
  name: string;
  slug: string;
  slugEdited: boolean;
  description: string;
  datasourceEntries: DatasourceEntry[];
  mergeRelationshipTypes: string[];
  ruleAnnotations: Annotation[];
  includeExternalRelations: boolean;
}

/** Persisted so navigating away from the editor and back doesn't discard
 *  in-progress edits. Scoped per rule id / "new" and kept in sessionStorage
 *  so it clears when the tab closes. */
function draftStorageKey(groupId: string | undefined): string {
  return workspaceEditorDraftKey('context-groups', groupId);
}

function parseDraft(raw: unknown): DraftFields | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const parsed = raw as Partial<DraftFields>;
  // Drafts persisted before the root/associated split was removed lack
  // `mergeRelationshipTypes`, so they fail this check and are discarded.
  if (
    typeof parsed.name !== 'string' ||
    !Array.isArray(parsed.datasourceEntries) ||
    !Array.isArray(parsed.mergeRelationshipTypes)
  ) {
    return null;
  }
  // Normalise fields added after earlier drafts may have been persisted.
  return {
    ...parsed,
    ruleAnnotations: Array.isArray(parsed.ruleAnnotations)
      ? parsed.ruleAnnotations
      : [],
    includeExternalRelations:
      typeof parsed.includeExternalRelations === 'boolean'
        ? parsed.includeExternalRelations
        : true,
  } as DraftFields;
}

export function ContextGroupEditor() {
  const { groupId } = useParams<{ groupId: string }>();
  // Remount the form when switching rules (or between a rule and "new") so
  // all draft/paging/selection state resets cleanly instead of leaking across
  // routes — /context-groups/:id and /context-groups/new share this one route
  // element.
  return <ContextGroupEditorForm key={groupId ?? 'new'} />;
}

function ContextGroupEditorForm() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const alertApi = useAlert();
  const datastore = useDatastore();
  const isNew = groupId === 'new';
  const storageKey = draftStorageKey(groupId);
  const draft = useEditorDraft<DraftFields>(storageKey, parseDraft);

  const { rule, loading, createRule, updateRule } = useContextGroupRule(
    isNew ? undefined : groupId,
  );
  const { dataSources } = useDataSources({ skipExecutions: true });
  const { rules: relationshipRules } = useRelationshipRules();
  // The slug rides the whole-form save, so this must be loaded whenever the
  // form can be submitted — not only while the slug popover is open.
  const renameGuard = useReferenceRename({ skip: isNew });

  // For a new rule, seed from a persisted draft up front so there's no blank
  // flash. Existing rules seed once loaded (below).
  const newDraftSeed = isNew ? draft.read() : null;
  const form = useZodForm({
    schema: contextGroupFormSchema,
    defaultValues: {
      name: newDraftSeed?.name ?? '',
      slug: newDraftSeed?.slug ?? '',
      description: newDraftSeed?.description ?? '',
    },
  });
  const name = form.watch('name');
  const slug = form.watch('slug');
  const description = form.watch('description');
  const rootError = form.formState.errors.root?.message;
  const nameError = form.formState.errors.name?.message;
  // While creating, the slug auto-tracks the name until the user edits it.
  const [slugEdited, setSlugEdited] = useState(
    newDraftSeed?.slugEdited ?? false,
  );
  const [datasourceEntries, setDatasourceEntries] = useState<DatasourceEntry[]>(
    newDraftSeed?.datasourceEntries ?? [],
  );
  const [mergeRelationshipTypes, setMergeRelationshipTypes] = useState<
    string[]
  >(newDraftSeed?.mergeRelationshipTypes ?? []);
  const [ruleAnnotations, setRuleAnnotations] = useState<Annotation[]>(
    newDraftSeed?.ruleAnnotations ?? [],
  );
  const [includeExternalRelations, setIncludeExternalRelations] =
    useState<boolean>(newDraftSeed?.includeExternalRelations ?? true);
  const [slugPopoverOpen, setSlugPopoverOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // Which pane is shown: group settings, a saved view (by id), or the
  // transient new-view draft.
  const [activeTab, setActiveTab] = useState(SETTINGS_TAB);
  const [creatingView, setCreatingView] = useState(false);
  // The materialized group whose full bundle is shown in the slideout, if any.
  const [bundleGroup, setBundleGroup] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { isSubmitting, isSubmitted } = form.formState;

  const [initialState, setInitialState] = useState<{
    name: string;
    slug: string;
    description: string;
    entries: DatasourceEntry[];
    mergeRelationshipTypes: string[];
    ruleAnnotations: Annotation[];
    includeExternalRelations: boolean;
  } | null>(null);

  const handleNameChange = useCallback(
    (value: string) => {
      form.setValue('name', value, { shouldDirty: true, shouldValidate: true });
      if (isNew && !slugEdited) {
        form.setValue('slug', slugify(value), {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    },
    [form, isNew, slugEdited],
  );

  // Committed on blur/Enter by the editable header title. Guard the
  // placeholder so dismissing an untouched title on a new group doesn't save
  // the placeholder as the name.
  const handleTitleChange = useCallback(
    (value: string) => {
      const next =
        value === UNTITLED_CONTEXT_GROUP_LABEL && !name.trim() ? '' : value;
      handleNameChange(next);
    },
    [handleNameChange, name],
  );

  const datasourceOptions: DatasourceOption[] = useMemo(
    () =>
      dataSources.map(ds => ({
        id: ds.id,
        name: ds.name,
        logoUrl: ds.logoUrl,
        enabled: ds.enabled,
      })),
    [dataSources],
  );

  const liveSelectedDatasourceIds = useMemo(
    () =>
      datasourceEntries
        .filter(entry => entry.status?.live !== false)
        .map(entryDatasourceId)
        .filter(Boolean),
    [datasourceEntries],
  );

  const selectedDatasources: DatasourceFilter[] = useMemo(
    () =>
      datasourceEntries
        .filter(e => entryDatasourceId(e) || e.seedName)
        .map(entryToFilter),
    [datasourceEntries],
  );

  // Projection per datasource id, for applying to the live preview so the token
  // estimate reflects the projected bundle rather than the full objects.
  const projectionByDatasourceId = useMemo(() => {
    const map = new Map<string, ProjectionValue>();
    for (const entry of datasourceEntries) {
      const id = entryDatasourceId(entry);
      if (id && entry.projection && hasProjectionContent(entry.projection)) {
        map.set(id, entry.projection);
      }
    }
    return map;
  }, [datasourceEntries]);

  // Per-datasource annotations, for showing them in the on-screen bundle JSON.
  const annotationByDatasourceId = useMemo(() => {
    const map = new Map<string, Annotation>();
    for (const entry of datasourceEntries) {
      const id = entryDatasourceId(entry);
      if (id && annotationHasContent(entry.annotation)) {
        map.set(id, entry.annotation as Annotation);
      }
    }
    return map;
  }, [datasourceEntries]);

  // Rule-level annotations that carry content, for the on-screen bundle JSON.
  const previewAnnotations = useMemo(
    () => ruleAnnotations.filter(a => a.title.trim() || a.text.trim()),
    [ruleAnnotations],
  );

  const previewDatasources: DatasourceFilter[] = useMemo(
    () =>
      datasourceEntries
        .filter(
          entry => entry.status?.live !== false && entryDatasourceId(entry),
        )
        .map(entry => {
          const filter = cleanEntryFilter(entry);
          return {
            datasourceId: entryDatasourceId(entry),
            ...(filter ? { filter } : {}),
          };
        }),
    [datasourceEntries],
  );

  const hasChanges = useMemo(() => {
    if (!initialState) return false;
    if (name !== initialState.name) return true;
    if (slug !== initialState.slug) return true;
    if (description !== initialState.description) return true;
    if (
      JSON.stringify(datasourceEntries) !== JSON.stringify(initialState.entries)
    )
      return true;
    if (
      JSON.stringify([...mergeRelationshipTypes].sort()) !==
      JSON.stringify([...initialState.mergeRelationshipTypes].sort())
    )
      return true;
    if (
      JSON.stringify(ruleAnnotations) !==
      JSON.stringify(initialState.ruleAnnotations)
    )
      return true;
    if (includeExternalRelations !== initialState.includeExternalRelations)
      return true;
    return false;
  }, [
    name,
    slug,
    description,
    datasourceEntries,
    mergeRelationshipTypes,
    ruleAnnotations,
    includeExternalRelations,
    initialState,
  ]);

  // Paging for the saved "Groups" view. The keyed remount resets it whenever
  // the rule changes.
  const [groupsOffset, setGroupsOffset] = useState(0);

  const { groups: storedGroups, loading: storedLoading } = useStoredGroups(
    isNew ? undefined : groupId,
    groupsOffset,
    GROUPS_PAGE_SIZE,
  );

  // The rule's named views drive the header tab strip: one tab each.
  const { data: views } = useQuery({
    ...contextGroupViewsQuery(datastore, groupId ?? ''),
    enabled: !isNew && !!groupId,
  });

  // If the active view disappears (deleted, or removed by a refetch),
  // fall back to the settings tab rather than showing an empty pane.
  useEffect(() => {
    if (activeTab === SETTINGS_TAB) return;
    if (activeTab === NEW_VIEW_TAB) {
      if (!creatingView) setActiveTab(SETTINGS_TAB);
      return;
    }
    if (views && !views.some(p => p.id === activeTab)) {
      setActiveTab(SETTINGS_TAB);
    }
  }, [views, activeTab, creatingView]);

  const { preview, loading: previewLoading } = usePreview(
    previewDatasources,
    mergeRelationshipTypes,
    isNew || hasChanges,
  );

  const displayData = useMemo(() => {
    if (isNew || hasChanges) {
      return preview;
    }
    return storedGroups;
  }, [isNew, hasChanges, preview, storedGroups]);

  const displayLoading = isNew || hasChanges ? previewLoading : storedLoading;

  // Paging only applies to the saved "Groups" view; the live preview is a
  // recomputed, capped snapshot with no offset support.
  const showingStored = !isNew && !hasChanges;
  const totalGroups = displayData?.totalGroups ?? 0;
  const pageCount = displayData?.groups.length ?? 0;

  const canPage = showingStored && totalGroups > GROUPS_PAGE_SIZE;

  // Seed at most once per genuinely loaded rule — the effect re-runs on
  // unrelated dependency changes, but must not re-seed (and overwrite edits)
  // or loop by calling setState on every render.
  const seededRuleRef = useRef<typeof rule>(undefined);
  useEffect(() => {
    if (rule) {
      if (seededRuleRef.current === rule) return;
      seededRuleRef.current = rule;
      const entries: DatasourceEntry[] = rule.datasources.map(ds => ({
        datasourceId: ds.datasourceId ?? ds.status?.datasourceId,
        seedName: ds.seedName ?? ds.status?.seedName,
        status: ds.status,
        filter: ds.filter,
        projection: ds.projection,
        annotation: ds.annotation,
      }));
      // Restore an unsaved draft if the user navigated away mid-edit;
      // otherwise seed from the persisted rule.
      const stored = draft.read();
      if (stored) {
        form.reset(
          {
            name: stored.name,
            slug: stored.slug,
            description: stored.description,
          },
          { keepDefaultValues: true },
        );
        setSlugEdited(stored.slugEdited);
        setDatasourceEntries(stored.datasourceEntries);
        setMergeRelationshipTypes(stored.mergeRelationshipTypes);
        setRuleAnnotations(stored.ruleAnnotations);
        setIncludeExternalRelations(stored.includeExternalRelations);
      } else {
        form.reset({
          name: rule.name,
          slug: rule.slug,
          description: rule.description ?? '',
        });
        setSlugEdited(true);
        setDatasourceEntries(entries);
        setMergeRelationshipTypes(rule.mergeRelationshipTypes ?? []);
        setRuleAnnotations(rule.annotations ?? []);
        setIncludeExternalRelations(rule.includeExternalRelations ?? true);
      }
      setInitialState({
        name: rule.name,
        slug: rule.slug,
        description: rule.description ?? '',
        entries,
        mergeRelationshipTypes: rule.mergeRelationshipTypes ?? [],
        ruleAnnotations: rule.annotations ?? [],
        includeExternalRelations: rule.includeExternalRelations ?? true,
      });
    } else if (isNew && !initialState) {
      setInitialState({
        name: '',
        slug: '',
        description: '',
        entries: [],
        mergeRelationshipTypes: [],
        ruleAnnotations: [],
        includeExternalRelations: true,
      });
    }
  }, [rule, isNew, draft, form, initialState]);

  // Persist the working draft so it survives navigating away and back. Skip
  // until an existing rule has seeded (initialState set); once it reverts to
  // its saved value, clear the draft so a stale copy isn't restored next visit.
  useEffect(() => {
    const skip = !isNew && !initialState;
    draft.persist(
      {
        name,
        slug,
        slugEdited,
        description,
        datasourceEntries,
        mergeRelationshipTypes,
        ruleAnnotations,
        includeExternalRelations,
      },
      isNew || hasChanges,
      skip,
    );
  }, [
    name,
    slug,
    slugEdited,
    description,
    datasourceEntries,
    mergeRelationshipTypes,
    ruleAnnotations,
    includeExternalRelations,
    hasChanges,
    isNew,
    initialState,
    draft,
  ]);

  const handleSave = form.handleSubmit(async values => {
    form.clearErrors('root');
    // The datasources live in component useState (not the zod schema) because
    // they're an interactive list rather than a plain field, so this required
    // check can't move into the resolver — validate it here before saving.
    if (selectedDatasources.length === 0) {
      form.setError('root', {
        message: 'At least one data source is required',
      });
      return;
    }

    try {
      const cleanAnnotations = ruleAnnotations.filter(
        a => a.title.trim() || a.text.trim(),
      );
      if (isNew) {
        const created = await createRule({
          name: values.name,
          slug: values.slug || undefined,
          description: values.description || undefined,
          datasources: selectedDatasources,
          mergeRelationshipTypes,
          annotations: cleanAnnotations,
          includeExternalRelations,
        });
        draft.clear();
        alertApi.post({
          message: 'Context group rule created',
          severity: 'success',
        });
        navigate(`/context-groups/${created.id}`, { replace: true });
      } else {
        const commit = async () => {
          const updated = await updateRule({
            name: values.name,
            slug: values.slug || undefined,
            // Sent verbatim: the PATCH treats an absent description as "no
            // change", so `|| undefined` would make a cleared description
            // silently revert on save.
            description: values.description,
            datasources: selectedDatasources,
            mergeRelationshipTypes,
            annotations: cleanAnnotations,
            includeExternalRelations,
          });
          form.reset({
            name: values.name,
            slug: updated.slug,
            description: values.description,
          });
          setInitialState({
            name: values.name,
            slug: updated.slug,
            description: values.description,
            entries: datasourceEntries,
            mergeRelationshipTypes,
            ruleAnnotations,
            includeExternalRelations,
          });
          draft.clear();
          alertApi.post({
            message: 'Context group rule updated',
            severity: 'success',
          });
        };

        // An emptied slug isn't a rename — the backend keeps the existing one.
        if (
          values.slug &&
          renameGuard.interceptRename({
            type: 'context-group',
            fromSlug: rule?.slug,
            toSlug: values.slug,
            commit,
          })
        ) {
          return;
        }
        await commit();
      }
    } catch (e: unknown) {
      form.setError('root', {
        message: e instanceof Error ? e.message : 'Failed to save',
      });
    }
  });

  const handleDiscardConfirm = () => {
    if (!initialState) return;
    form.reset({
      name: initialState.name,
      slug: initialState.slug,
      description: initialState.description,
    });
    setSlugEdited(true);
    setDatasourceEntries(initialState.entries);
    setMergeRelationshipTypes(initialState.mergeRelationshipTypes);
    setRuleAnnotations(initialState.ruleAnnotations);
    setIncludeExternalRelations(initialState.includeExternalRelations);
    draft.clear();
    setShowDiscardConfirm(false);
  };

  const pageTitle = resolveContextGroupPageTitle(isNew, name);

  if (loading && !isNew) {
    return (
      <EntityEditorShell>
        <EntityEditorHeader
          section="context-groups"
          title={pageTitle}
          documentTitle={`Edit ${name || 'Context Group'}`}
        />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </EntityEditorShell>
    );
  }

  // The group's resolved data source ids, for previewing its scope in the
  // relationships editor (works before save — uses the current selection).
  const scopeDatasourceIds = datasourceEntries
    .map(entryDatasourceId)
    .filter(Boolean);

  // Name lives in the editable header title (data-source / capability parity).
  const titleText = name.trim() ? name : UNTITLED_CONTEXT_GROUP_LABEL;

  const previewDatasourceIds = previewDatasources
    .map(d => d.datasourceId)
    .filter((id): id is string => Boolean(id));

  // The right-hand groups column for a view tab: the same stored-groups
  // table as the settings tab, but each expanded row renders through the
  // template being edited (supplied by the pane via `renderExpanded`).
  const storedTotalGroups = storedGroups?.totalGroups ?? 0;
  const storedPageCount = storedGroups?.groups.length ?? 0;
  const renderViewPreview = (
    renderExpanded: (group: ContextGroupPreviewGroup) => ReactNode,
  ) => (
    <GroupsPreviewColumn
      groups={storedGroups?.groups ?? []}
      totalGroups={storedTotalGroups}
      offset={groupsOffset}
      loading={storedLoading}
      datasources={datasourceOptions}
      datasourceIds={previewDatasourceIds}
      projectionByDatasourceId={projectionByDatasourceId}
      annotationByDatasourceId={annotationByDatasourceId}
      annotations={previewAnnotations}
      ruleName={name}
      renderExpanded={renderExpanded}
      expandedLabel="This view"
      pagination={
        storedTotalGroups > GROUPS_PAGE_SIZE ? (
          <GroupsPagination
            offset={groupsOffset}
            pageCount={storedPageCount}
            totalGroups={storedTotalGroups}
            loading={storedLoading}
            onOffsetChange={setGroupsOffset}
          />
        ) : undefined
      }
    />
  );

  return (
    // Fields render on the page background (not a card), so the outlined labels
    // must mask their border with the background color.
    <TooltipProvider delayDuration={300}>
      <EntityEditorShell
        style={{ '--field-bg': 'var(--color-background)' } as CSSProperties}
      >
        {/* The Form context must wrap the header too — the slug popover in the
            title adornment renders FormFields. */}
        <Form {...form}>
          <EntityEditorHeader
            section="context-groups"
            title={titleText}
            documentTitle={
              isNew ? 'New Context Group' : `Edit ${name || 'Context Group'}`
            }
            editable
            onTitleChange={handleTitleChange}
            description={description}
            editableDescription
            onDescriptionChange={value =>
              form.setValue('description', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            titleAdornment={
              <Popover open={slugPopoverOpen} onOpenChange={setSlugPopoverOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-auto gap-1.5 px-1.5 py-0 font-mono text-2xs"
                        data-testid="context-group-slug-trigger"
                      >
                        <Hash className="size-3.5" />
                        {slug || 'slug'}
                        <UnreferenceableSlugIcon
                          type="context-group"
                          slug={slug}
                        />
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {slugTriggerTooltip('context-group', slug, 'Edit slug')}
                  </TooltipContent>
                </Tooltip>
                <PopoverContent align="start" className="w-80 space-y-4">
                  <FormField
                    control={form.control}
                    name="slug"
                    render={({ field }) => (
                      <FormItem className="space-y-2">
                        <FormLabel>Slug</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., employee"
                            {...field}
                            onChange={e => {
                              setSlugEdited(true);
                              field.onChange(e);
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          {isNew &&
                            'Auto-filled from the name — edit to override. '}
                          Reference this context group in a capability with{' '}
                          <code>@context-group:{slug || 'slug'}</code>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </PopoverContent>
              </Popover>
            }
            saveState="manual"
            isDirty={hasChanges}
            saving={isSubmitting}
            saveDisabled={!hasChanges}
            onSave={handleSave}
            saveLabel={isNew ? 'Create' : 'Save'}
            actions={
              <div className="flex items-center gap-2">
                {scopeDatasourceIds.length > 0 && (
                  <ViewRelationshipGraphButton
                    to={relationshipsScoped({
                      dataSourceIds: scopeDatasourceIds,
                    })}
                  />
                )}
                {!isNew && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowDiscardConfirm(true)}
                    disabled={!hasChanges || isSubmitting}
                    data-testid="context-group-discard"
                  >
                    <Undo2 className="size-4" />
                    Reset changes
                  </Button>
                )}
              </div>
            }
          />

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="h-auto min-h-[40px] w-full shrink-0 justify-start rounded-none border-b border-border bg-transparent p-0 px-4">
              <TabsTrigger
                value={SETTINGS_TAB}
                className={EDITOR_TAB_TRIGGER_CLASS}
              >
                Group settings
              </TabsTrigger>
              <Separator orientation="vertical" className="mx-2 h-4" />
              {(views ?? []).map(view => (
                <TabsTrigger
                  key={view.id}
                  value={view.id}
                  className={EDITOR_TAB_TRIGGER_CLASS}
                >
                  {view.name}
                  {view.isDefault && (
                    <Star aria-hidden className="ml-1.5 size-3 fill-current" />
                  )}
                </TabsTrigger>
              ))}
              {creatingView && (
                <TabsTrigger
                  value={NEW_VIEW_TAB}
                  className={EDITOR_TAB_TRIGGER_CLASS}
                >
                  New view
                </TabsTrigger>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-1 inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Add view"
                      disabled={isNew}
                      onClick={() => {
                        setCreatingView(true);
                        setActiveTab(NEW_VIEW_TAB);
                      }}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {isNew ? 'Create the group to add views' : 'Add view'}
                </TooltipContent>
              </Tooltip>
            </TabsList>

            <TabsContent
              value={SETTINGS_TAB}
              className="mt-0 flex min-h-0 flex-1 gap-6 overflow-hidden p-6"
            >
              <fieldset
                disabled={isSubmitting}
                className="w-[26rem] shrink-0 space-y-8 overflow-y-auto pt-2 pr-1"
              >
                {/* Name lives in the header title and slug in its popover —
                  neither has a FormMessage slot — so their validation errors
                  and the save/root error surface here. The name error is gated
                  on a submit attempt so onChange validation doesn't flash it
                  mid-edit. */}
                {((isSubmitted && nameError) || rootError) && (
                  <div
                    role="alert"
                    className="space-y-1 text-xs text-destructive"
                  >
                    {isSubmitted && nameError && <p>{nameError}</p>}
                    {rootError && <p>{rootError}</p>}
                  </div>
                )}

                <DatasourceSelector
                  entries={datasourceEntries}
                  onChange={setDatasourceEntries}
                  datasources={datasourceOptions}
                />

                <MergeRelationshipTypesSelector
                  selectedTypes={mergeRelationshipTypes}
                  onChange={setMergeRelationshipTypes}
                  availableRules={relationshipRules}
                  selectedDatasourceIds={liveSelectedDatasourceIds}
                  datasources={datasourceOptions}
                />

                <div className="space-y-2">
                  <Label>External relations</Label>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="include-external-relations"
                      checked={includeExternalRelations}
                      onCheckedChange={checked =>
                        setIncludeExternalRelations(checked === true)
                      }
                    />
                    <Label
                      htmlFor="include-external-relations"
                      className="cursor-pointer text-sm font-normal"
                    >
                      Include relations to objects outside the bundle as
                      identifiers only
                    </Label>
                  </div>
                </div>

                <RuleAnnotationsEditor
                  annotations={ruleAnnotations}
                  onChange={setRuleAnnotations}
                />
              </fieldset>

              <GroupsPreviewColumn
                groups={displayData?.groups ?? []}
                totalGroups={totalGroups}
                offset={showingStored ? groupsOffset : 0}
                loading={displayLoading}
                datasources={datasourceOptions}
                datasourceIds={previewDatasourceIds}
                projectionByDatasourceId={projectionByDatasourceId}
                annotationByDatasourceId={annotationByDatasourceId}
                annotations={previewAnnotations}
                ruleName={name}
                onSeeFullBundle={
                  showingStored
                    ? (id, groupName) => setBundleGroup({ id, name: groupName })
                    : undefined
                }
                pagination={
                  canPage ? (
                    <GroupsPagination
                      offset={groupsOffset}
                      pageCount={pageCount}
                      totalGroups={totalGroups}
                      loading={displayLoading}
                      onOffsetChange={setGroupsOffset}
                    />
                  ) : undefined
                }
              />
            </TabsContent>

            {!isNew &&
              groupId &&
              (views ?? []).map(view => (
                <TabsContent
                  key={view.id}
                  value={view.id}
                  className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <ViewPane
                    ruleId={groupId}
                    view={view}
                    renderPreview={renderViewPreview}
                    onDeleted={() => setActiveTab(SETTINGS_TAB)}
                  />
                </TabsContent>
              ))}

            {!isNew && groupId && creatingView && (
              <TabsContent
                value={NEW_VIEW_TAB}
                className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <ViewPane
                  ruleId={groupId}
                  renderPreview={renderViewPreview}
                  onCreated={created => {
                    setCreatingView(false);
                    setActiveTab(created.id);
                  }}
                  onCancelCreate={() => {
                    setCreatingView(false);
                    setActiveTab(SETTINGS_TAB);
                  }}
                />
              </TabsContent>
            )}
          </Tabs>
        </Form>

        <FullBundleDrawer
          group={bundleGroup}
          onClose={() => setBundleGroup(null)}
        />
        <ConfirmationDialog
          open={showDiscardConfirm}
          isDelete
          title="Discard unsaved changes?"
          contentText="This reverts the context group to its last saved version. This cannot be undone."
          confirmButtonText="Discard"
          onConfirm={handleDiscardConfirm}
          onCancel={() => setShowDiscardConfirm(false)}
        />
        {renameGuard.dialog}
      </EntityEditorShell>
    </TooltipProvider>
  );
}
