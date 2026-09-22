import { type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { InlineCode } from '@roadiehq/ui/inline-code';
import { ToggleGroup } from '@roadiehq/ui/toggle-group';
import { AdvancedSection } from '@roadiehq/ui/advanced-section';
import type {
  IntegrationBackedConfig,
  RelationshipRuleMatchStrategy,
} from '../../../api/datastore/datastore-client';
import { type SchemaField } from './schema-field-utils';
import { ruleSummaryPhraseForMatchStrategy } from './inspector-shared';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import { FieldColumn } from './field-column';
import { ReciprocalField } from './reciprocal-field';
import {
  MatchStrategyField,
  RelationshipFilterField,
  RelationshipTypeField,
} from './rule-fields';
import {
  DEFAULT_INTEGRATION_CONFIG,
  IntegrationBackedRuleFields,
} from './integration-backed-rule-fields';

export interface RuleSummaryProps {
  sourceLabel: string;
  targetLabel: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  relationshipType: string;
  reciprocalRelationshipType: string;
  matchStrategy: RelationshipRuleMatchStrategy;
  strategy?: RelationshipRuleEditorState['strategy'];
  integrationConfig?: IntegrationBackedConfig | null;
  /** Display name for the integration; falls back to the raw id when absent. */
  integrationName?: string;
}

export function RuleSummary({
  sourceLabel,
  targetLabel,
  sourceFieldExpression,
  targetFieldExpression,
  relationshipType,
  reciprocalRelationshipType,
  matchStrategy,
  strategy = 'field-matching',
  integrationConfig,
  integrationName,
}: RuleSummaryProps) {
  const srcField = sourceFieldExpression.trim();
  const tgtField = targetFieldExpression.trim();
  const rel = relationshipType.trim();
  const reciprocal = reciprocalRelationshipType.trim();

  const isIntegrationBacked = strategy === 'integration-backed';
  // The editor accepts either a literal path or an advanced path expression, so
  // treat either as a filled-in request path.
  const requestPath =
    integrationConfig?.path.trim() ||
    integrationConfig?.pathExpression?.trim() ||
    '';
  const isComplete = isIntegrationBacked
    ? !!srcField &&
      !!rel &&
      !!integrationConfig?.integrationId.trim() &&
      !!requestPath &&
      !!integrationConfig.responseMatchExpression.trim()
    : !!srcField && !!tgtField && !!rel;

  if (!isComplete) {
    return (
      <div className="truncate text-xs text-muted-foreground">
        Fill in the fields below to see what this rule will do.
      </div>
    );
  }

  return (
    <div className="truncate text-xs leading-relaxed text-foreground">
      {isIntegrationBacked && integrationConfig ? (
        <>
          Extract <InlineCode>{srcField}</InlineCode> from{' '}
          <span className="font-semibold">{sourceLabel}</span>, call{' '}
          <InlineCode>
            {integrationName?.trim() || integrationConfig.integrationId}
            {requestPath}
          </InlineCode>
          , then match response values with{' '}
          <InlineCode>{integrationConfig.responseMatchExpression}</InlineCode>{' '}
          to create{' '}
          <span className="font-mono font-medium text-primary">{rel}</span>{' '}
          relationships to <span className="font-semibold">{targetLabel}</span>.
          {integrationConfig.metadataExpression && (
            <span className="ml-2 text-[11px] text-muted-foreground">
              Metadata from{' '}
              <span className="font-mono">
                {integrationConfig.metadataExpression}
              </span>
              .
            </span>
          )}
        </>
      ) : (
        <>
          Link each <span className="font-semibold">{sourceLabel}</span> to a{' '}
          <span className="font-semibold">{targetLabel}</span> where{' '}
          <InlineCode>{srcField}</InlineCode>{' '}
          <span className="text-muted-foreground">
            {ruleSummaryPhraseForMatchStrategy(matchStrategy)}
          </span>{' '}
          <InlineCode>{tgtField}</InlineCode>, as{' '}
          <span className="font-mono font-medium text-primary">{rel}</span>.
          {reciprocal && (
            <span className="ml-2 text-[11px] text-muted-foreground">
              Also creates reverse{' '}
              <span className="font-mono">{reciprocal}</span> from {targetLabel}{' '}
              to {sourceLabel}.
            </span>
          )}
        </>
      )}
    </div>
  );
}

interface RuleSectionProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function RuleSection({
  title,
  actions,
  children,
  className,
}: RuleSectionProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col rounded-md border border-border bg-card/60 p-3 [--field-bg:var(--color-card)]',
        className,
      )}
    >
      {(title || actions) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && (
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {title}
            </div>
          )}
          {actions && (
            <div className="ml-auto flex items-center gap-1.5">{actions}</div>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

interface RelationshipRuleFormProps {
  sourceLabel: string;
  targetLabel: string;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  editor: RelationshipRuleEditorState;
  /**
   * The materialized-relationships preview. Rendered on the right in
   * integration-backed mode (beside the definition) and below the form in
   * field-matching mode. Owned by the inspector so it keeps its preview state.
   */
  previewSection?: ReactNode;
}

export function RelationshipRuleForm({
  sourceLabel,
  targetLabel,
  sourceFields,
  targetFields,
  editor,
  previewSection,
}: RelationshipRuleFormProps) {
  const strategyToggle = (
    <div className="flex shrink-0 items-center justify-between gap-3">
      <div>
        <div className="text-xs font-semibold text-foreground">Strategy</div>
        <div className="text-xs text-muted-foreground">
          Match stored values or resolve the relationship through an
          integration.
        </div>
      </div>
      <ToggleGroup
        aria-label="Relationship rule strategy"
        value={editor.strategy}
        onValueChange={strategy => {
          editor.setStrategy(strategy);
          if (strategy === 'integration-backed' && !editor.integrationConfig) {
            editor.setIntegrationConfig({ ...DEFAULT_INTEGRATION_CONFIG });
          }
        }}
        items={[
          { value: 'field-matching', label: 'Field matching' },
          { value: 'integration-backed', label: 'Integration lookup' },
        ]}
      />
    </div>
  );

  const sourceTargetCard = (
    <RuleSection className="shrink-0">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <FieldColumn
          heading="SOURCE"
          accessibleLabel="Source field"
          entityLabel={sourceLabel}
          fields={sourceFields}
          value={editor.sourceFieldExpression}
          onChange={editor.setSourceFieldExpression}
        />
        <div className="flex items-center justify-center text-muted-foreground">
          <ArrowRight className="size-4 rotate-90 md:rotate-0" />
        </div>
        <FieldColumn
          heading="TARGET"
          accessibleLabel="Target field"
          entityLabel={targetLabel}
          fields={targetFields}
          value={editor.targetFieldExpression}
          onChange={editor.setTargetFieldExpression}
        />
      </div>
    </RuleSection>
  );

  const configCard = (
    <RuleSection className="shrink-0">
      {editor.isIntegrationBacked ? (
        <IntegrationBackedRuleFields editor={editor} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <RelationshipTypeField editor={editor} />
          <MatchStrategyField editor={editor} />
          <ReciprocalField editor={editor} className="md:col-span-2" />
        </div>
      )}
    </RuleSection>
  );

  const renderFilters = (innerGridClass: string) => (
    <AdvancedSection
      label="Filters"
      variant="embedded"
      className="shrink-0"
      defaultOpen={Boolean(
        editor.sourceFilterExpression || editor.targetFilterExpression,
      )}
    >
      <div className={cn('grid gap-3', innerGridClass)}>
        <RelationshipFilterField editor={editor} side="source" />
        <RelationshipFilterField editor={editor} side="target" />
      </div>
    </AdvancedSection>
  );

  // Integration-backed rules have a tall config panel (Filters live inside it as
  // a collapsible section), so stack the compact source→target card above it on
  // the left and give the preview the whole right column. Field-matching keeps
  // the source | config split with the preview below.
  if (editor.isIntegrationBacked) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {strategyToggle}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-3 overflow-auto">
            {sourceTargetCard}
            {configCard}
          </div>
          <div className="flex min-h-0 flex-col gap-3">{previewSection}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {strategyToggle}
      <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
        {sourceTargetCard}
        {configCard}
      </div>
      {renderFilters('lg:grid-cols-2')}
      {previewSection}
    </div>
  );
}
