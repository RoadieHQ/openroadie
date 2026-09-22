import { useEffect } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { Badge } from '@roadiehq/ui/badge';
import { Separator } from '@roadiehq/ui/separator';
import type {
  Relationship,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import { DetailSection } from '../../common';
import { DirectRelationshipList } from './direct-relationships-inspector';
import { OverviewStatusCell, type OverviewStatusTone } from '../../overview';
import {
  DataSourceCard,
  MetadataRow,
  describeMatchStrategy,
  describeRuleOrigin,
  describeRuleState,
  formatTimestamp,
} from './inspector-shared';

/** Rule state → status tone, matching the app-wide status taxonomy. */
function ruleStateTone(state: string): OverviewStatusTone {
  if (state === 'active') return 'success';
  if (state === 'suggested') return 'warning';
  return 'muted';
}

interface ReadOnlyRuleInspectorProps {
  open: boolean;
  rule: RelationshipRule | null;
  sourceDataSource: DataSourceItem | undefined;
  targetDataSource: DataSourceItem | undefined;
  /** Direct edges folded into this rule's graph edge (same pair + type). */
  directRelationships?: Relationship[];
  /** Opens the direct-relationship edit drawer in place. */
  onEditDirectRelationship?: (relationship: Relationship) => void;
  onClose: () => void;
}

export function ReadOnlyRuleInspector({
  open,
  rule,
  sourceDataSource,
  targetDataSource,
  directRelationships,
  onEditDirectRelationship,
  onClose,
}: ReadOnlyRuleInspectorProps) {
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
      aria-label="Relationship rule details"
      aria-hidden={!open}
      inert={!open}
    >
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            Relationship details
          </div>
          {rule && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <OverviewStatusCell
                expanded
                tone={ruleStateTone(rule.state)}
                label={describeRuleState(rule.state)}
              />
              <Badge variant="outline" className="text-2xs">
                {describeRuleOrigin(rule.origin)}
              </Badge>
            </div>
          )}
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
        {rule ? (
          <>
            <DataSourceCard
              heading="Source"
              ds={sourceDataSource}
              fallbackId={rule.sourceDatasourceId}
            />
            <div className="flex justify-center text-muted-foreground">
              <ArrowRight className="size-4" />
            </div>
            <DataSourceCard
              heading="Target"
              ds={targetDataSource}
              fallbackId={rule.targetDatasourceId}
            />

            <DetailSection title="Rule">
              <div>
                <MetadataRow label="Relationship type">
                  <span className="font-mono">{rule.relationshipType}</span>
                </MetadataRow>
                {rule.reciprocalRelationshipType && (
                  <MetadataRow label="Reciprocal">
                    <span className="font-mono">
                      {rule.reciprocalRelationshipType}
                    </span>
                  </MetadataRow>
                )}
                <MetadataRow label="Match strategy">
                  <div>
                    <div>{rule.matchStrategy}</div>
                    <div className="mt-0.5 text-2xs text-muted-foreground">
                      {describeMatchStrategy(rule.matchStrategy)}
                    </div>
                  </div>
                </MetadataRow>
                <MetadataRow label="Source field">
                  <span className="font-mono break-all">
                    {rule.sourceFieldExpression}
                  </span>
                </MetadataRow>
                <MetadataRow label="Target field">
                  <span className="font-mono break-all">
                    {rule.targetFieldExpression}
                  </span>
                </MetadataRow>
              </div>
            </DetailSection>

            {directRelationships && directRelationships.length > 0 && (
              <DetailSection
                title="Direct relationships"
                count={directRelationships.length}
              >
                <DirectRelationshipList
                  relationships={directRelationships}
                  onEditRelationship={onEditDirectRelationship}
                />
              </DetailSection>
            )}

            <DetailSection title="Stats">
              <div>
                <MetadataRow label="Created">
                  {formatTimestamp(rule.createdAt) ?? '-'}
                </MetadataRow>
                <MetadataRow label="Updated">
                  {formatTimestamp(rule.updatedAt) ?? '-'}
                </MetadataRow>
                {typeof rule.score === 'number' && (
                  <MetadataRow label="Score">
                    {rule.score.toFixed(2)}
                  </MetadataRow>
                )}
                {rule.confidenceBand && (
                  <MetadataRow label="Confidence">
                    {rule.confidenceBand}
                  </MetadataRow>
                )}
              </div>
            </DetailSection>
          </>
        ) : null}
      </div>
    </div>
  );
}
