import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { EmptyState } from '@roadiehq/ui/empty-state';
import { Spinner } from '@roadiehq/ui/spinner';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ListChecks,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  GenerateSuggestionsDialog,
  type GenerateSuggestionsDataSource,
} from './generate-suggestions-dialog';
import type {
  FieldMatchSuggestion,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import { relationshipRuleEdit } from '../../../config/paths';
import { useAlert } from '../../../api';
import {
  DIRECTION_DISPLAY_CAP,
  VISIBLE_PILL_LIMIT,
  buildInverseMap,
  getConfidenceCardClassesForBand,
  getConfidenceHighlightClassesForBand,
  groupRules,
  pluralS,
  type ConfidenceFilter,
} from './suggested-rules-utils';
import { useSuggestionReview } from './use-suggestion-review';
import { SuggestionStepSummary } from './suggestion-step-summary';
import { PillButton } from './inspector-shared';
import { DismissedRulesSection } from './dismissed-rules-section';
import { SuppressedSuggestionsSection } from './suppressed-suggestions-section';

/**
 * The suggestions list, as plain content that fills its container. It used to
 * own drawer chrome of its own — a portal, a resize handle, a header with the
 * bulk actions. `DrawerStack` owns all of that now, and both call sites render
 * the list inside it, so none of those props had a caller left.
 */
interface SuggestedRulesPanelProps {
  suggestedRules: RelationshipRule[];
  highlightedRuleId: string | null;
  datasourceLabels: Map<string, string>;
  /** Integration logo per datasource id, matching the canvas nodes. Cards
   *  fall back to the generic database glyph for ids not in the map. */
  datasourceLogos?: Map<string, string>;
  /** Gate/rank-suppressed candidates from the last Generate run, for the
   *  "Suppressed this run" section above Dismissed. */
  suppressedSuggestions?: FieldMatchSuggestion[];
  onApproveMany: (ruleIds: string[]) => Promise<void>;
  onDismissMany: (ruleIds: string[]) => Promise<void>;
  onSuggestedRuleClick: (ruleId: string) => void;
  onSuggestedRuleHover: (ruleId: string | null) => void;
  /** Supply the shared actions state when the header's bulk buttons live
   *  outside this component, so both drive the same in-flight ids. */
  actionsState?: SuggestedRulesPanelActionsState;
  expandedRuleId?: string | null;
  onToggleRuleExpanded?: (ruleId: string) => void;
  /** `rankShown` is the row's 0-based position in the ordered list — the
   *  expanded inspector must record it on its approve/dismiss verdict too, or
   *  a careful (expanded) review loses the presentation rank a quick approve
   *  from the collapsed card would have captured. */
  renderExpandedRule?: (rule: RelationshipRule, rankShown: number) => ReactNode;
}

interface SuggestedRulesPanelActionsOptions {
  suggestedRules: RelationshipRule[];
  onApproveMany: (ruleIds: string[]) => Promise<void>;
  onDismissMany: (ruleIds: string[]) => Promise<void>;
  /** Forwarded verbatim to the underlying `useSuggestionReview` — e.g. the
   *  graph view's layout-save, so a per-card approve/dismiss persists layout
   *  too, not just the bulk actions. */
  onAfterMutation?: () => void | Promise<void>;
}

export interface SuggestedRulesPanelActionsState {
  loadingIds: ReadonlySet<string>;
  bulkLoading: boolean;
  /** `rankShown` is the row's 0-based position in the ordered list the user
   *  was looking at when they clicked Approve/Dismiss. */
  approve: (ruleId: string, rankShown?: number) => Promise<void>;
  dismiss: (ruleId: string, rankShown?: number) => Promise<void>;
  approveSuggestion: (ruleId: string, rankShown?: number) => Promise<void>;
  dismissSuggestion: (ruleId: string, rankShown?: number) => Promise<void>;
  handleApproveAll: () => Promise<void>;
  handleDismissAll: () => Promise<void>;
  handleApproveManyFiltered: (ruleIds: string[]) => Promise<void>;
  handleDismissManyFiltered: (ruleIds: string[]) => Promise<void>;
}

export function useSuggestedRulesPanelActions({
  suggestedRules,
  onApproveMany,
  onDismissMany,
  onAfterMutation,
}: SuggestedRulesPanelActionsOptions): SuggestedRulesPanelActionsState {
  const alertApi = useAlert();
  const [bulkLoading, setBulkLoading] = useState(false);
  const { approveSuggestion, dismissSuggestion, pendingRuleIds } =
    useSuggestionReview({ onAfterMutation });

  const approve = useCallback(
    (ruleId: string, rankShown?: number) =>
      approveSuggestion(ruleId, rankShown).catch(() => undefined),
    [approveSuggestion],
  );
  const dismiss = useCallback(
    (ruleId: string, rankShown?: number) =>
      dismissSuggestion(ruleId, rankShown).catch(() => undefined),
    [dismissSuggestion],
  );

  const postActionError = useCallback(
    (actionName: string, e: unknown) => {
      alertApi.post({
        message: `Failed to ${actionName}: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`,
        severity: 'error',
      });
    },
    [alertApi],
  );

  const handleApproveManyFiltered = useCallback(
    async (ruleIds: string[]) => {
      setBulkLoading(true);
      try {
        // The backend arbitrates mirrored suggestion pairs server-side now.
        await onApproveMany(ruleIds);
      } catch (e: unknown) {
        postActionError('approve suggestions', e);
      } finally {
        setBulkLoading(false);
      }
    },
    [onApproveMany, postActionError],
  );

  const handleDismissManyFiltered = useCallback(
    async (ruleIds: string[]) => {
      setBulkLoading(true);
      try {
        await onDismissMany(ruleIds);
      } catch (e: unknown) {
        postActionError('dismiss suggestions', e);
      } finally {
        setBulkLoading(false);
      }
    },
    [onDismissMany, postActionError],
  );

  const handleApproveAll = useCallback(
    () => handleApproveManyFiltered(suggestedRules.map(r => r.id)),
    [handleApproveManyFiltered, suggestedRules],
  );

  const handleDismissAll = useCallback(
    () => handleDismissManyFiltered(suggestedRules.map(r => r.id)),
    [handleDismissManyFiltered, suggestedRules],
  );

  return {
    loadingIds: pendingRuleIds,
    bulkLoading,
    approve,
    dismiss,
    approveSuggestion,
    dismissSuggestion,
    handleApproveAll,
    handleDismissAll,
    handleApproveManyFiltered,
    handleDismissManyFiltered,
  };
}

export function SuggestedRulesHeaderActions({
  suggestedRules,
  generating,
  actionsState,
  onGenerateAll,
  dataSources,
  onGenerateForDataSources,
  selectedDataSourceIds,
}: {
  suggestedRules: RelationshipRule[];
  generating: boolean;
  actionsState: SuggestedRulesPanelActionsState;
  /** Generate for every enabled data source. Only offered on surfaces with
   *  an explicit scope of their own (the standalone page's facet filter) —
   *  the canvas surface is selection-only so a misclick can't fan out a
   *  tenant-wide run. */
  onGenerateAll?: () => Promise<void>;
  /** Enabled data sources offered in the scoped-generate picker dialog.
   *  For surfaces without a canvas (the standalone suggestions page). */
  dataSources?: GenerateSuggestionsDataSource[];
  /** Scoped generate: pairs within the given data sources only. */
  onGenerateForDataSources?: (datasourceIds: string[]) => Promise<void>;
  /**
   * Canvas-driven scope: the data sources currently selected on the graph
   * (Suggest mode toggles them by node click). When provided, Generate is
   * strictly selection-scoped — enabled only at two or more selections —
   * and the picker dialog is not offered.
   */
  selectedDataSourceIds?: string[];
}) {
  const [scopedDialogOpen, setScopedDialogOpen] = useState(false);
  const selectionDriven = selectedDataSourceIds !== undefined;
  const selectedCount = selectedDataSourceIds?.length ?? 0;
  const generateScoped =
    selectionDriven && selectedCount >= 2 && onGenerateForDataSources
      ? () => onGenerateForDataSources(selectedDataSourceIds)
      : undefined;
  // The dialog affordance only appears on non-canvas surfaces with at least
  // two sources to pick from.
  const dialogGenerate =
    !selectionDriven &&
    onGenerateForDataSources &&
    (dataSources?.length ?? 0) >= 2
      ? onGenerateForDataSources
      : undefined;
  const generateTitle = generateScoped
    ? `Generate suggestions between the ${selectedCount} selected data sources`
    : selectionDriven
      ? selectedCount === 1
        ? 'Select at least one more data source — suggestions need a pair'
        : 'Select two or more data sources on the canvas to generate suggestions between them'
      : 'Run suggestion generation for every enabled data source';
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-2xs"
        onClick={() => {
          void (generateScoped ? generateScoped() : onGenerateAll?.());
        }}
        disabled={generating || (selectionDriven && selectedCount < 2)}
        title={generateTitle}
      >
        {generating ? (
          <Spinner className="size-3" />
        ) : selectionDriven ? (
          <ListChecks className="size-3" />
        ) : (
          <Sparkles className="size-3" />
        )}
        {generateScoped ? `Generate (${selectedCount})` : 'Generate'}
      </Button>
      {dialogGenerate && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-2xs"
            onClick={() => setScopedDialogOpen(true)}
            disabled={generating}
            title="Generate suggestions between selected data sources only"
          >
            <ListChecks className="size-3" />
            Between…
          </Button>
          <GenerateSuggestionsDialog
            open={scopedDialogOpen}
            onOpenChange={setScopedDialogOpen}
            dataSources={dataSources ?? []}
            generating={generating}
            onGenerate={dialogGenerate}
          />
        </>
      )}
      {suggestedRules.length > 0 && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-2xs"
            onClick={actionsState.handleDismissAll}
            disabled={
              actionsState.bulkLoading ||
              actionsState.loadingIds.size > 0 ||
              suggestedRules.length === 0
            }
          >
            Dismiss all ({suggestedRules.length})
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 border-success/30 bg-success/10 text-2xs font-semibold text-success hover:bg-success/20"
            onClick={actionsState.handleApproveAll}
            disabled={
              actionsState.bulkLoading ||
              actionsState.loadingIds.size > 0 ||
              suggestedRules.length === 0
            }
          >
            {actionsState.bulkLoading ? (
              <Spinner className="size-3" />
            ) : (
              <CheckCheck className="size-3" />
            )}
            Approve all ({suggestedRules.length})
          </Button>
        </>
      )}
    </>
  );
}

export function SuggestedRulesPanel({
  suggestedRules,
  highlightedRuleId,
  datasourceLabels,
  datasourceLogos,
  suppressedSuggestions,
  onApproveMany,
  onDismissMany,
  onSuggestedRuleClick,
  onSuggestedRuleHover,
  actionsState: externalActionsState,
  expandedRuleId,
  onToggleRuleExpanded,
  renderExpandedRule,
}: SuggestedRulesPanelProps) {
  // One confidence filter for the whole panel. It used to be per direction —
  // the same three buttons repeated in every section header, filtering an axis
  // nobody wants to set differently for A→B than for B→A.
  const [confidenceFilter, setConfidenceFilter] =
    useState<ConfidenceFilter>('all');
  const [activePairKeys, setActivePairKeys] = useState<Set<string>>(new Set());
  // True after the user explicitly empties the pill set (e.g. clicking the
  // active "All" pill). Suppresses the auto-select-first-pair fallback so
  // the panel can show an empty "select a pair" state on demand.
  const userClearedRef = useRef(false);
  const previousGroupKeySignatureRef = useRef('');
  const [collapsedDirectionKeys, setCollapsedDirectionKeys] = useState<
    Set<string>
  >(new Set());
  // One-way per direction: "Show N more" adds a key, nothing removes it.
  // Direction keys embed the pair key (`${pairKey}|${source}→${target}`), so
  // switching pairs naturally renders a different key set — same as
  // `collapsedDirectionKeys`, no reset effect needed.
  const [expandedDirectionKeys, setExpandedDirectionKeys] = useState<
    Set<string>
  >(new Set());

  const internalActionsState = useSuggestedRulesPanelActions({
    suggestedRules,
    onApproveMany,
    onDismissMany,
  });
  const actionsState = externalActionsState ?? internalActionsState;

  const groups = useMemo(
    () => groupRules(suggestedRules, datasourceLabels),
    [suggestedRules, datasourceLabels],
  );

  // Pair pills, busiest first. Scoping by data source is the header filter
  // bar's job (`?ds`) — it narrows `suggestedRules` before the panel sees
  // them, so a second data-source control here would filter the same axis
  // twice, out of sync and without the URL.
  const sortedGroups = useMemo(
    () =>
      [...groups].sort((a, b) => {
        if (a.rules.length !== b.rules.length) {
          return b.rules.length - a.rules.length;
        }
        const left = a.leftLabel.localeCompare(b.leftLabel);
        return left !== 0 ? left : a.rightLabel.localeCompare(b.rightLabel);
      }),
    [groups],
  );

  // Offer only the bands actually present, and only when there's a choice to
  // make — a lone band filters nothing.
  const availableBands = useMemo(() => {
    const present = new Set(suggestedRules.map(r => r.confidenceBand ?? 'low'));
    return present.size > 1
      ? ([
          'all',
          ...(['high', 'medium', 'low'] as const).filter(b => present.has(b)),
        ] as ConfidenceFilter[])
      : [];
  }, [suggestedRules]);

  // A band that disappears (last suggestion in it approved/dismissed) must not
  // leave the panel filtered to nothing.
  useEffect(() => {
    if (
      confidenceFilter !== 'all' &&
      !availableBands.includes(confidenceFilter)
    ) {
      setConfidenceFilter('all');
    }
  }, [availableBands, confidenceFilter]);

  // Maintain the invariant: if any pair pills exist, at least one is active.
  // - First render with non-empty groups → auto-select the first.
  // - When approves/dismisses prune the active pair → drop it from the set
  //   and, if the set is now empty, fall back to the first remaining pair.
  // - When `groups` is empty, leave the active set empty (panel shows the
  //   empty-state instead of pills).
  useEffect(() => {
    const groupKeySignature = groups.map(g => g.key).join('\0');
    if (previousGroupKeySignatureRef.current !== groupKeySignature) {
      previousGroupKeySignatureRef.current = groupKeySignature;
      userClearedRef.current = false;
    }
    const groupKeys = new Set(groups.map(g => g.key));
    const filtered = [...activePairKeys].filter(k => groupKeys.has(k));
    let nextKeys: string[] = filtered;
    if (filtered.length === 0 && groups.length > 0 && !userClearedRef.current) {
      nextKeys = [groups[0].key];
    }
    const same =
      nextKeys.length === activePairKeys.size &&
      nextKeys.every(k => activePairKeys.has(k));
    if (!same) {
      setActivePairKeys(new Set(nextKeys));
    }
  }, [groups, activePairKeys]);

  const inverseByRuleId = useMemo(
    () => buildInverseMap(suggestedRules),
    [suggestedRules],
  );

  const togglePillSelection = useCallback((pairKeyToToggle: string) => {
    userClearedRef.current = false;
    setActivePairKeys(prev => {
      const next = new Set(prev);
      if (next.has(pairKeyToToggle)) {
        next.delete(pairKeyToToggle);
      } else {
        next.add(pairKeyToToggle);
      }
      return next;
    });
  }, []);

  const toggleDirection = useCallback((directionKey: string) => {
    setCollapsedDirectionKeys(prev => {
      const next = new Set(prev);
      if (next.has(directionKey)) {
        next.delete(directionKey);
      } else {
        next.add(directionKey);
      }
      return next;
    });
  }, []);

  const expandDirection = useCallback((directionKey: string) => {
    setExpandedDirectionKeys(prev => new Set(prev).add(directionKey));
  }, []);

  const visiblePairPills = sortedGroups.slice(0, VISIBLE_PILL_LIMIT);
  const overflowPairPills = sortedGroups.slice(VISIBLE_PILL_LIMIT);
  const allPairsActive =
    sortedGroups.length > 0 &&
    sortedGroups.every(g => activePairKeys.has(g.key));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        {groups.length > 0 && (
          <div className="space-y-1.5 border-b border-border px-3 py-2">
            {availableBands.length > 0 && (
              <div
                className="flex items-center gap-1"
                data-testid="suggestion-confidence-filter"
              >
                <span className="mr-1 text-2xs text-muted-foreground">
                  Confidence
                </span>
                {availableBands.map(band => (
                  <Button
                    key={band}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfidenceFilter(band)}
                    aria-pressed={confidenceFilter === band}
                    className={cn(
                      'h-auto rounded px-2 py-0.5 text-2xs font-medium tracking-wide uppercase',
                      confidenceFilter === band
                        ? 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {band}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <PillButton
                isActive={allPairsActive}
                count={sortedGroups.length}
                onClick={() => {
                  if (allPairsActive) {
                    userClearedRef.current = true;
                    setActivePairKeys(new Set());
                  } else {
                    userClearedRef.current = false;
                    setActivePairKeys(new Set(sortedGroups.map(g => g.key)));
                  }
                }}
              >
                <span className="font-medium">All pairs</span>
              </PillButton>
              {visiblePairPills.map(group => (
                <PillButton
                  key={group.key}
                  isActive={activePairKeys.has(group.key)}
                  count={group.rules.length}
                  onClick={() => togglePillSelection(group.key)}
                >
                  <span className="font-medium">{group.leftLabel}</span>
                  <ArrowLeftRight className="size-3 opacity-70" />
                  <span className="font-medium">{group.rightLabel}</span>
                </PillButton>
              ))}
              {overflowPairPills.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-2xs text-muted-foreground"
                    >
                      +{overflowPairPills.length} more
                      <ChevronDown className="size-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="max-h-72 w-96 space-y-1 overflow-auto p-2"
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {overflowPairPills.map(group => (
                        <PillButton
                          key={group.key}
                          isActive={activePairKeys.has(group.key)}
                          count={group.rules.length}
                          onClick={() => togglePillSelection(group.key)}
                        >
                          <span className="font-medium">{group.leftLabel}</span>
                          <ArrowLeftRight className="size-3 opacity-70" />
                          <span className="font-medium">
                            {group.rightLabel}
                          </span>
                        </PillButton>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-auto p-3">
          {suggestedRules.length === 0 ? (
            <EmptyState
              className="flex-1 px-4"
              icon={<Wand2 className="size-8" />}
              title="No suggestions right now"
              description="Run suggestions on a data source from the canvas (the wand icon on each node) to see proposed relationship rules here."
            />
          ) : groups.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center text-xs text-muted-foreground">
              No suggestions match the current filter.
            </div>
          ) : activePairKeys.size === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center text-xs text-muted-foreground">
              Select a pair above to review its suggestions.
            </div>
          ) : (
            sortedGroups
              .filter(group => activePairKeys.has(group.key))
              .flatMap(group => group.directions)
              .map(direction => {
                const directionCollapsed = collapsedDirectionKeys.has(
                  direction.key,
                );
                const filteredDirectionRules =
                  confidenceFilter === 'all'
                    ? direction.rules
                    : direction.rules.filter(
                        // Null bands count as low everywhere else (the
                        // chips' availableBands, the card styling) — a
                        // strict compare here would leave the Low chip
                        // matching nothing but true-'low' rules.
                        r => (r.confidenceBand ?? 'low') === confidenceFilter,
                      );
                const filteredRuleIds = filteredDirectionRules.map(r => r.id);
                // Bulk actions above always use `filteredRuleIds`, built from
                // the full list — never the capped/rendered slice — so
                // "Approve all"/"Dismiss all" act on every rule in the
                // direction regardless of how many rows are visible.
                const isDirectionExpanded =
                  expandedDirectionKeys.has(direction.key) ||
                  filteredDirectionRules.length <= DIRECTION_DISPLAY_CAP;
                const hiddenRuleCount = isDirectionExpanded
                  ? 0
                  : filteredDirectionRules.length - DIRECTION_DISPLAY_CAP;
                return (
                  <section key={direction.key} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={
                          directionCollapsed
                            ? 'Expand direction'
                            : 'Collapse direction'
                        }
                        className="-ml-1 size-5 shrink-0 rounded p-0 text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3"
                        onClick={() => toggleDirection(direction.key)}
                      >
                        {directionCollapsed ? (
                          <ChevronRight className="size-3" />
                        ) : (
                          <ChevronDown className="size-3" />
                        )}
                      </Button>
                      <span className="text-xs font-medium text-foreground">
                        {direction.sourceLabel}
                      </span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground">
                        {direction.targetLabel}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs font-semibold text-muted-foreground">
                        {filteredDirectionRules.length}
                        {confidenceFilter !== 'all' && (
                          <>/{direction.rules.length}</>
                        )}{' '}
                        suggestion{pluralS(filteredDirectionRules.length)}
                      </span>
                      <div className="ml-auto flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-2xs"
                          onClick={async () => {
                            await actionsState.handleDismissManyFiltered(
                              filteredRuleIds,
                            );
                          }}
                          disabled={
                            actionsState.bulkLoading ||
                            actionsState.loadingIds.size > 0 ||
                            filteredRuleIds.length === 0
                          }
                        >
                          Dismiss all ({filteredRuleIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 border-success/30 bg-success/10 px-2 text-2xs font-semibold text-success hover:bg-success/20"
                          onClick={async () => {
                            await actionsState.handleApproveManyFiltered(
                              filteredRuleIds,
                            );
                          }}
                          disabled={
                            actionsState.bulkLoading ||
                            actionsState.loadingIds.size > 0 ||
                            filteredRuleIds.length === 0
                          }
                        >
                          <CheckCheck className="size-3" />
                          Approve all ({filteredRuleIds.length})
                        </Button>
                      </div>
                    </div>
                    {!directionCollapsed && (
                      <div className="space-y-2">
                        {filteredDirectionRules.length === 0 && (
                          <div className="px-3 py-4 text-center text-2xs text-muted-foreground">
                            No suggestions match this filter.
                          </div>
                        )}
                        {filteredDirectionRules.map((rule, rowIndex) => {
                          // rowIndex is the row's position in the filtered,
                          // sorted per-direction list — the same order the
                          // reviewer sees — not the rendered slice. Rows past
                          // the display cap return null below rather than
                          // being sliced off the array first, so rowIndex
                          // (and the rankShown it feeds) never restarts at 0
                          // for the rows revealed by "Show N more".
                          if (
                            !isDirectionExpanded &&
                            rowIndex >= DIRECTION_DISPLAY_CAP
                          ) {
                            return null;
                          }
                          const isLoading = actionsState.loadingIds.has(
                            rule.id,
                          );
                          const isHighlighted = rule.id === highlightedRuleId;
                          const isExpanded = expandedRuleId === rule.id;
                          const handleToggleExpanded = () =>
                            (onToggleRuleExpanded ?? onSuggestedRuleClick)(
                              rule.id,
                            );
                          const band = rule.confidenceBand ?? 'low';
                          const hasInverse = inverseByRuleId.has(rule.id);
                          return (
                            <div
                              key={rule.id}
                              data-testid={`suggestion-card-${rule.id}`}
                              role="button"
                              tabIndex={0}
                              className={cn(
                                'motion-colors cursor-pointer rounded-md border border-l-4 border-border px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                getConfidenceCardClassesForBand(band),
                                isHighlighted &&
                                  getConfidenceHighlightClassesForBand(band),
                              )}
                              onClick={e => {
                                // Interactive descendants (the chevron
                                // toggle, Approve/Dismiss buttons, anything
                                // inside the inline review editor) handle
                                // their own click; don't also toggle here.
                                if (
                                  (e.target as HTMLElement).closest('button, a')
                                ) {
                                  return;
                                }
                                (onToggleRuleExpanded ?? onSuggestedRuleClick)(
                                  rule.id,
                                );
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  (
                                    onToggleRuleExpanded ?? onSuggestedRuleClick
                                  )(rule.id);
                                }
                              }}
                              onMouseEnter={() => onSuggestedRuleHover(rule.id)}
                              onMouseLeave={() => onSuggestedRuleHover(null)}
                            >
                              <div className="min-w-0">
                                <SuggestionStepSummary
                                  rule={rule}
                                  sourceLabel={
                                    datasourceLabels.get(
                                      rule.sourceDatasourceId,
                                    ) ?? rule.sourceDatasourceId
                                  }
                                  targetLabel={
                                    datasourceLabels.get(
                                      rule.targetDatasourceId,
                                    ) ?? rule.targetDatasourceId
                                  }
                                  sourceLogoUrl={datasourceLogos?.get(
                                    rule.sourceDatasourceId,
                                  )}
                                  targetLogoUrl={datasourceLogos?.get(
                                    rule.targetDatasourceId,
                                  )}
                                  expanded={isExpanded}
                                  onToggleExpanded={handleToggleExpanded}
                                  // The card body toggles expansion, so a
                                  // chevron here would be a second control
                                  // for the same thing. Offer the rule's own
                                  // page instead.
                                  trailing={
                                    <Button
                                      asChild
                                      variant="ghost"
                                      size="icon"
                                      className="size-7 shrink-0 self-center text-muted-foreground hover:text-foreground [&_svg]:size-4"
                                    >
                                      <a
                                        href={relationshipRuleEdit(rule.id)}
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Open this rule in a new tab"
                                        aria-label="Open this rule in a new tab"
                                        onClick={e => e.stopPropagation()}
                                      >
                                        <ExternalLink />
                                      </a>
                                    </Button>
                                  }
                                  // An expanded card routes approve/dismiss
                                  // through the inline review's action
                                  // cluster (which persists tweaks first) —
                                  // these quick buttons would bypass any
                                  // pending edit and silently discard it.
                                  actions={
                                    isExpanded && renderExpandedRule ? null : (
                                      <div className="flex shrink-0 gap-1">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-7 gap-1 px-2 text-2xs"
                                          onClick={e => {
                                            e.stopPropagation();
                                            void actionsState.dismiss(
                                              rule.id,
                                              rowIndex,
                                            );
                                          }}
                                          disabled={
                                            isLoading ||
                                            actionsState.bulkLoading
                                          }
                                        >
                                          Dismiss
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-7 gap-1 border-success/30 bg-success/10 px-2 text-2xs font-semibold text-success hover:bg-success/20"
                                          onClick={e => {
                                            e.stopPropagation();
                                            void actionsState.approve(
                                              rule.id,
                                              rowIndex,
                                            );
                                          }}
                                          disabled={
                                            isLoading ||
                                            actionsState.bulkLoading
                                          }
                                        >
                                          {isLoading ? (
                                            <Spinner className="size-3" />
                                          ) : (
                                            <Check className="size-3" />
                                          )}
                                          Approve
                                        </Button>
                                      </div>
                                    )
                                  }
                                />
                              </div>
                              <div className="min-w-0">
                                {(() => {
                                  // Built as a list (rather than each
                                  // chip owning a leading separator) so
                                  // whichever chip renders first — now
                                  // that the relationshipType text that
                                  // used to lead this row moved into
                                  // SuggestionStepSummary — never shows
                                  // an orphan "·".
                                  const metaChips = [
                                    hasInverse && (
                                      <span
                                        key="inverse"
                                        className="inline-flex shrink-0 items-center gap-0.5 font-mono"
                                        title="An inverse rule (with swapped source/target fields) exists in the opposite direction"
                                      >
                                        <ArrowLeftRight className="size-2.5" />
                                        inverse
                                      </span>
                                    ),
                                  ].filter((chip): chip is React.ReactElement =>
                                    Boolean(chip),
                                  );
                                  if (metaChips.length === 0) return null;
                                  return (
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                                      {metaChips.map((chip, i) => (
                                        <Fragment key={chip.key}>
                                          {i > 0 && (
                                            <span className="opacity-50">
                                              ·
                                            </span>
                                          )}
                                          {chip}
                                        </Fragment>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                              {isExpanded && renderExpandedRule
                                ? renderExpandedRule(rule, rowIndex)
                                : null}
                            </div>
                          );
                        })}
                        {hiddenRuleCount > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full text-2xs text-muted-foreground"
                            onClick={() => expandDirection(direction.key)}
                          >
                            Show {hiddenRuleCount} more
                          </Button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })
          )}
          <SuppressedSuggestionsSection
            suppressedSuggestions={suppressedSuggestions}
            datasourceLabels={datasourceLabels}
          />
          <DismissedRulesSection />
        </div>
      </div>
    </div>
  );
}
