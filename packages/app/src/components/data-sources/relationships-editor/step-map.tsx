import { Fragment, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, Plus } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { splitFieldPath } from './field-expression';
import { MATCH_STRATEGIES } from './inspector-shared';
import { addLookupStage, type StageRole } from './relationship-stages';
import { useIntegrations } from '../../integrations/use-integrations';
import { useLogoResolver } from '../use-resolved-logo';
import { RemoveLookupButton } from './step-preview-cards';
import { RunPreviewButton } from './run-preview-button';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import { Card } from '@roadiehq/ui/card';

export interface StageMeta {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}

export type MapSegment<R extends string = StageRole> =
  | {
      kind: 'node';
      role: R;
      title: string;
      subtitle?: string;
      // Optional HTTP method pill shown next to the title (Lookup node only).
      method?: string;
      icon: React.ReactNode;
      present: boolean;
    }
  | { kind: 'field'; text: string }
  // The match: the edge itself. Its `relationship` is the edge verb (the node
  // title); `detail` annotates how the sides join — field-matching names its
  // strategy ("Exact · login"), an integration lookup is a fixed equality join
  // ("= login").
  | { kind: 'match'; relationship: string; detail: string }
  | { kind: 'add' };

/**
 * Builds the left→right step-map segments for the pipeline, reading
 * "Source → <source field> → Lookup → <lookup request> → <target field> → Match".
 * Pure so the sequencing logic (which segments appear, in what order) can be
 * unit-tested without rendering.
 */
export function buildMapSegments({
  meta,
  isIntegrationBacked,
  method,
  sourceLeaf,
  targetLeaf,
  matchStrategyLabel,
  relationshipType,
  resolvedLookupPath,
  lookupPath,
}: {
  meta: Record<StageRole, StageMeta>;
  isIntegrationBacked: boolean;
  method: string;
  sourceLeaf: string;
  targetLeaf: string;
  matchStrategyLabel: string;
  relationshipType: string;
  resolvedLookupPath: string | undefined;
  lookupPath: string;
}): MapSegment[] {
  return [
    // Source and Target endpoints show the data source they belong to; the
    // Lookup is an integration call, so its request rides the following segment.
    {
      kind: 'node',
      role: 'source',
      title: meta.source.title,
      subtitle: meta.source.subtitle,
      icon: meta.source.icon,
      present: true,
    },
    // Connecting fields only appear once configured — a blank new rule shows
    // just the endpoints and the "+".
    ...(sourceLeaf ? [{ kind: 'field', text: sourceLeaf } as const] : []),
    // Integration-backed: a Lookup node carrying its request as the subtitle.
    // Field-matching: a "+" that inserts the (optional) lookup step.
    ...(isIntegrationBacked
      ? [
          {
            kind: 'node',
            role: 'lookup',
            title: 'HTTP Lookup',
            method,
            // The resolved request URL (source value substituted); falls back to
            // the raw path template until the sample source value loads.
            subtitle: resolvedLookupPath || lookupPath || 'not configured',
            icon: meta.lookup.icon,
            present: true,
          } as const,
        ]
      : [{ kind: 'add' } as const]),
    // The match names the strategy and the target field it joins on; it only
    // appears once a target field is chosen.
    ...(targetLeaf
      ? [
          {
            kind: 'match',
            relationship: relationshipType.trim(),
            detail: isIntegrationBacked
              ? `= ${targetLeaf}`
              : `${matchStrategyLabel} · ${targetLeaf}`,
          } as const,
        ]
      : []),
    {
      kind: 'node',
      role: 'match',
      title: meta.match.title,
      subtitle: meta.match.subtitle,
      icon: meta.match.icon,
      present: true,
    },
  ];
}

function StepNodeBody({
  seg,
}: {
  seg: Extract<MapSegment<string>, { kind: 'node' }>;
}) {
  return (
    <>
      <IntegrationIconFrame size="row">{seg.icon}</IntegrationIconFrame>
      <span className="flex max-w-[20rem] min-w-0 flex-col text-left">
        <span className="truncate text-sm font-semibold text-foreground">
          {seg.title}
        </span>
        {seg.subtitle && (
          <span
            className="truncate text-2xs text-muted-foreground"
            title={seg.subtitle}
          >
            {seg.subtitle}
          </span>
        )}
      </span>
      {/* HTTP method pill pinned to the right of the node (Lookup). */}
      {seg.method && (
        <Badge
          variant="outlineMuted"
          className="ml-auto shrink-0 font-mono text-[10px] leading-none"
        >
          {seg.method}
        </Badge>
      )}
    </>
  );
}

export interface StepMapChromeProps<R extends string = StageRole> {
  segments: MapSegment<R>[];
  expanded: boolean;
  onToggleExpanded: () => void;
  pipelineId: string;
  /** Roles rendered pressed (their config panel is open). */
  activeRoles?: ReadonlySet<R>;
  /** Node click → jump to / toggle that stage. Omit for non-interactive nodes. */
  onNodeClick?: (role: R) => void;
  /** Per-node overlay actions (e.g. the Lookup run/remove hover controls),
   *  rendered inside the node's relative container. */
  nodeActions?: (role: R) => ReactNode;
  /** Handler for the "+" add-step affordance (field-matching only). */
  onAdd?: () => void;
  /** Pinned at the head of the map, outside the scroll area — metadata about
   *  the map rather than a step in it (e.g. a suggestion's score badge). */
  leading?: ReactNode;
  /** Rendered at the tail, just before the expand toggle (e.g. a suggestion's
   *  approve/dismiss buttons). */
  actions?: ReactNode;
  /** Drop the surrounding card. Use when the map is already inside a card of
   *  its own — a card in a card reads as two separate things. */
  bare?: boolean;
  /** Replaces the built-in expand/collapse toggle. For maps whose container
   *  owns expansion, where a chevron here would be a second, lying control. */
  trailing?: ReactNode;
}

function CardSurface({ children }: { children: ReactNode }) {
  return (
    <Card variant="flat" className="flex items-center gap-2 p-2">
      {children}
    </Card>
  );
}

function BareSurface({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

/**
 * The presentational step-map: a left→right flow of `node → field/match → node`
 * segments with arrow connectors and a preview expand/collapse toggle. Pure
 * chrome — it renders whatever {@link MapSegment}s it's given and knows nothing
 * about rules, integrations, or manual edges. Interactivity (node clicks, the
 * "+" add step, per-node overlay actions) is opt-in via callbacks, so the same
 * chrome serves the rule editor and the manual single-edge editor.
 */
export function StepMapChrome<R extends string = StageRole>({
  segments,
  expanded,
  onToggleExpanded,
  pipelineId,
  activeRoles,
  onNodeClick,
  nodeActions,
  onAdd,
  leading,
  actions,
  bare,
  trailing,
}: StepMapChromeProps<R>) {
  const Surface = bare ? BareSurface : CardSurface;
  return (
    <Surface>
      {leading}
      {/* Steps center when they fit and scroll horizontally when they overflow;
          the expand/collapse toggle stays pinned outside the scroll area. */}
      <div className="min-w-0 flex-1 scrollbar-thin overflow-x-auto">
        <div className="mx-auto flex w-max items-center gap-x-1.5">
          {segments.map((seg, i) => (
            // Key on the segment's kind/role, not the array index: segments are
            // conditionally present (a field/lookup can appear or vanish), so an
            // index key would reassign identity across a kind change. Each kind
            // is unique in the list (one source/lookup/match/field/add).
            <Fragment key={seg.kind === 'node' ? `node:${seg.role}` : seg.kind}>
              {i > 0 && (
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              )}
              {seg.kind === 'node' ? (
                <div className="group relative flex shrink-0 items-center">
                  {onNodeClick ? (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={activeRoles?.has(seg.role) ?? false}
                      onClick={() => onNodeClick(seg.role)}
                      className={cn(
                        'h-auto shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5',
                        activeRoles?.has(seg.role)
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent hover:border-muted-foreground/40 hover:bg-muted/50',
                        !seg.present && 'border-dashed',
                      )}
                    >
                      <StepNodeBody seg={seg} />
                    </Button>
                  ) : (
                    <div
                      className={cn(
                        'flex h-auto shrink-0 items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5',
                        !seg.present && 'border-dashed',
                      )}
                    >
                      <StepNodeBody seg={seg} />
                    </div>
                  )}
                  {nodeActions?.(seg.role)}
                </div>
              ) : seg.kind === 'add' ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Add lookup step"
                  title="Add lookup step"
                  onClick={onAdd}
                  className="size-7 shrink-0 rounded-full border border-dashed border-border p-0 text-muted-foreground hover:text-foreground [&_svg]:size-4"
                >
                  <Plus />
                </Button>
              ) : seg.kind === 'match' ? (
                // Informational annotation: the relationship verb over
                // "<strategy> · <field>". The edge config lives in the panel
                // below, so this stays non-interactive.
                <div className="flex h-auto shrink-0 items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5">
                  <span className="flex max-w-[20rem] min-w-0 flex-col text-left">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {seg.relationship || 'Match'}
                    </span>
                    <span
                      className="truncate text-2xs text-muted-foreground"
                      title={seg.detail}
                    >
                      {seg.detail}
                    </span>
                  </span>
                </div>
              ) : (
                // The source field feeding the next step — styled like the
                // Match annotation (node box, no icon, non-interactive) so both
                // connectors read consistently: a label over its value.
                <div className="flex h-auto shrink-0 items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5">
                  <span className="flex max-w-[20rem] min-w-0 flex-col text-left">
                    <span className="truncate text-sm font-semibold text-foreground">
                      Field
                    </span>
                    <span
                      className="truncate font-mono text-2xs text-muted-foreground"
                      title={seg.text}
                    >
                      {seg.text}
                    </span>
                  </span>
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
      {actions}
      {trailing ?? (
        <>
          {/* Show/hide the preview panels below. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={
              expanded ? 'Hide preview panels' : 'Show preview panels'
            }
            title={expanded ? 'Hide preview panels' : 'Show preview panels'}
            aria-expanded={expanded}
            aria-controls={pipelineId}
            onClick={onToggleExpanded}
            className="size-7 shrink-0 self-center text-muted-foreground hover:text-foreground [&_svg]:size-4"
          >
            <ChevronDown
              className={cn(
                'motion-transform-standard-reduced',
                expanded ? '' : 'rotate-180',
              )}
            />
          </Button>
        </>
      )}
    </Surface>
  );
}

/**
 * The rule editor's step map: builds the segments from the rule editor state
 * (fields, integration lookup, match strategy) and renders them through
 * {@link StepMapChrome}, injecting the Lookup node's run/remove hover controls.
 */
export function StepMap({
  editor,
  sourceLabel,
  targetLabel,
  sourceLogoUrl,
  targetLogoUrl,
  resolvedLookupPath,
  configRoles,
  toggleConfig,
  openConfig,
  closeConfig,
  expanded,
  onToggleExpanded,
  pipelineId,
  leading,
}: {
  editor: RelationshipRuleEditorState;
  sourceLabel: string;
  targetLabel: string;
  sourceLogoUrl?: string;
  targetLogoUrl?: string;
  resolvedLookupPath: string | undefined;
  configRoles: ReadonlySet<StageRole>;
  toggleConfig: (role: StageRole) => void;
  openConfig: (role: StageRole) => void;
  closeConfig: (role: StageRole) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  pipelineId: string;
  leading?: ReactNode;
}) {
  const { integrations } = useIntegrations({
    skip: !editor.isIntegrationBacked,
  });
  const resolveLogo = useLogoResolver();
  const lookupIntegration = editor.integrationConfig?.integrationId
    ? integrations.find(i => i.id === editor.integrationConfig?.integrationId)
    : undefined;
  const lookupLogo = resolveLogo(lookupIntegration);

  const meta: Record<StageRole, StageMeta> = {
    source: {
      icon: <IntegrationLogo src={sourceLogoUrl ?? ''} size={20} />,
      title: 'Source',
      subtitle: sourceLabel,
    },
    lookup: {
      icon: <IntegrationLogo src={lookupLogo ?? ''} size={20} />,
      title: 'Lookup',
      subtitle: (() => {
        const c = editor.integrationConfig;
        const path = c?.path?.trim();
        if (!path) return 'Not configured';
        return `${c?.method ?? 'GET'} ${path}${
          lookupIntegration ? ` — ${lookupIntegration.name}` : ''
        }`;
      })(),
    },
    match: {
      icon: <IntegrationLogo src={targetLogoUrl ?? ''} size={20} />,
      title: 'Target',
      // The relationship verb now rides the Match segment (the edge), so the
      // Target endpoint node shows only which data source it is.
      subtitle: targetLabel,
    },
  };

  // Path only (no method prefix — the map node shows the method as a pill). The
  // resolved URL is preferred; this raw template is the fallback shown until the
  // sample source value loads.
  const lookupPath = editor.integrationConfig?.path?.trim() || '';
  const matchStrategyLabel =
    MATCH_STRATEGIES.find(s => s.value === editor.matchStrategy)?.label ??
    editor.matchStrategy;

  const mapSegments = buildMapSegments({
    meta,
    isIntegrationBacked: editor.isIntegrationBacked,
    method: editor.integrationConfig?.method ?? 'GET',
    sourceLeaf: splitFieldPath(editor.sourceFieldExpression).leaf,
    targetLeaf: splitFieldPath(editor.targetFieldExpression).leaf,
    matchStrategyLabel,
    relationshipType: editor.relationshipType,
    resolvedLookupPath,
    lookupPath,
  });

  return (
    <StepMapChrome
      segments={mapSegments}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      pipelineId={pipelineId}
      leading={leading}
      activeRoles={configRoles}
      onNodeClick={toggleConfig}
      onAdd={() => {
        addLookupStage(editor);
        openConfig('lookup');
      }}
      nodeActions={role =>
        // Lookup actions ride the node, revealed on hover, right-aligned. A
        // card-colored gradient sits behind them so they read cleanly over the
        // node's subtitle text.
        role === 'lookup' ? (
          <div className="absolute inset-y-1 right-1 hidden items-center gap-0.5 rounded-r-md bg-gradient-to-l from-card via-card to-transparent pr-1 pl-6 group-hover:flex">
            <RunPreviewButton editor={editor} />
            <RemoveLookupButton
              editor={editor}
              onRemoved={() => closeConfig('lookup')}
            />
          </div>
        ) : null
      }
    />
  );
}
