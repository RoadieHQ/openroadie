import { useMemo, type ReactNode } from 'react';
import { Database } from 'lucide-react';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import {
  buildMapSegments,
  StepMapChrome,
  type MapSegment,
  type StageMeta,
} from './step-map';
import { prettifyFieldExpression } from './suggested-rules-utils';
import { SuggestionEvidenceBadge } from './suggestion-evidence-badge';

const NODE_ICON = <Database className="size-5 text-muted-foreground" />;

// Match the canvas nodes and the editor step-map: the data source's
// integration logo when it has one, the generic database glyph otherwise.
function nodeIcon(logoUrl: string | undefined): ReactNode {
  return logoUrl ? <IntegrationLogo src={logoUrl} size={20} /> : NODE_ICON;
}

export function suggestionStepSegments(
  rule: RelationshipRule,
  sourceLabel: string,
  targetLabel: string,
  sourceLogoUrl?: string,
  targetLogoUrl?: string,
): MapSegment[] {
  const meta: Record<'source' | 'lookup' | 'match', StageMeta> = {
    source: {
      icon: nodeIcon(sourceLogoUrl),
      title: 'Source',
      subtitle: sourceLabel,
    },
    lookup: { icon: NODE_ICON, title: 'Lookup', subtitle: '' },
    match: {
      icon: nodeIcon(targetLogoUrl),
      title: 'Target',
      subtitle: targetLabel,
    },
  };
  return buildMapSegments({
    meta,
    isIntegrationBacked:
      (rule.strategy ?? 'field-matching') === 'integration-backed',
    method: rule.integrationConfig?.method ?? 'GET',
    sourceLeaf: prettifyFieldExpression(rule.sourceFieldExpression),
    targetLeaf: prettifyFieldExpression(rule.targetFieldExpression),
    matchStrategyLabel: (rule.matchStrategy ?? 'exact').replace(/_/g, ' '),
    relationshipType: rule.relationshipType,
    resolvedLookupPath: undefined,
    lookupPath: rule.integrationConfig?.path ?? '',
    // A read-only card never offers the "+" add-step affordance.
  }).filter(segment => segment.kind !== 'add');
}

/**
 * A suggested rule as a compact read-only step-map — the same visual language
 * as the editor a reviewer lands in. The chrome's expand toggle is the card's
 * expand/inspect affordance (wired by the caller).
 */
export function SuggestionStepSummary({
  rule,
  sourceLabel,
  targetLabel,
  sourceLogoUrl,
  targetLogoUrl,
  expanded,
  onToggleExpanded,
  actions,
  trailing,
}: {
  rule: RelationshipRule;
  sourceLabel: string;
  targetLabel: string;
  sourceLogoUrl?: string;
  targetLogoUrl?: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Quick approve/dismiss, rendered inline before the expand toggle. */
  actions?: ReactNode;
  /** Replaces the expand chevron (e.g. an open-in-new-tab link) for callers
   *  whose card body already owns expansion. */
  trailing?: ReactNode;
}) {
  const segments = useMemo(
    () =>
      suggestionStepSegments(
        rule,
        sourceLabel,
        targetLabel,
        sourceLogoUrl,
        targetLogoUrl,
      ),
    [rule, sourceLabel, targetLabel, sourceLogoUrl, targetLogoUrl],
  );
  return (
    <StepMapChrome
      // The card the summary sits in already supplies the surface and the
      // confidence-tinted border; a nested card would read as two suggestions.
      bare
      leading={<SuggestionEvidenceBadge rule={rule} />}
      actions={actions}
      trailing={trailing}
      segments={segments}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      pipelineId={`suggestion-${rule.id}`}
    />
  );
}
