import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Network, Waypoints } from 'lucide-react';
import { EditorHeader } from '@roadiehq/ui/editor-header';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import type {
  RelationshipRule,
  RelationshipRuleInput,
} from '../../api/datastore/datastore-client';
import { useAlert } from '../../api';
import { PATHS, relationshipBetween } from '../../config/paths';
import { formatErrorString } from '../../api/workflow/parse-execution-error';
import { useRelationshipsCatalog } from '../data-sources/use-relationships-catalog';
import { extractSchemaFields } from '../data-sources/relationships-editor/schema-field-utils';
import { DataSourceFacetFilter } from '../data-sources/relationships-editor/data-source-facet-filter';
import type { SchemaField } from '../data-sources/relationships-editor/schema-field-utils';
import {
  RelationshipRuleInspector,
  RelationshipRuleInspectorActions,
} from '../data-sources/relationships-editor/relationship-rule-inspector';
import {
  SuggestedRulesHeaderActions,
  SuggestedRulesPanel,
  useSuggestedRulesPanelActions,
} from '../data-sources/relationships-editor/suggested-rules-panel';
import { useRelationshipRuleTransitions } from '../data-sources/relationships-editor/use-relationship-rule-transitions';
import { useRelationshipSuggestionActions } from '../data-sources/relationships-editor/use-relationship-suggestion-actions';
import { useRelationshipRuleMutations } from '../data-sources/relationships-editor/use-relationship-rule-mutations';
import { useRelationshipRuleEditor } from '../data-sources/relationships-editor/use-relationship-rule-editor';
import { useSuggestionReview } from '../data-sources/relationships-editor/use-suggestion-review';
import { SuggestionInlineReview } from '../data-sources/relationships-editor/suggestion-inline-review';

function PageLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {label}
    </div>
  );
}

export function RelationshipsSuggestionsPage() {
  const alertApi = useAlert();
  const [highlightedRuleId, setHighlightedRuleId] = useState<string | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const {
    enabledDataSources,
    datasourceLabels,
    schemaByDatasourceId,
    rules,
    loading,
    error,
  } = useRelationshipsCatalog();
  const { saveRule, previewRule } = useRelationshipRuleMutations();

  useEffect(() => {
    if (error) {
      alertApi.post({
        message: `Failed to load relationship suggestions: ${formatErrorString(error)}`,
        severity: 'error',
      });
    }
  }, [error, alertApi]);

  // Data-source scope, in the URL under the same `?ds` key the relationships
  // page uses — the panel has no data-source control of its own, so this is
  // what narrows the list here, and the link stays shareable.
  const [searchParams, setSearchParams] = useSearchParams();
  const scopedDataSourceIds = useMemo(() => {
    const raw = searchParams.get('ds');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [searchParams]);

  const handleScopeChange = useCallback(
    (ids: string[]) => {
      setSearchParams(
        params => {
          const next = new URLSearchParams(params);
          if (ids.length > 0) {
            next.set('ds', ids.join(','));
          } else {
            next.delete('ds');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Scoped enabled sources: an empty scope means every enabled source.
  const scopedDataSources = useMemo(() => {
    if (scopedDataSourceIds.length === 0) {
      return enabledDataSources;
    }
    const scoped = new Set(scopedDataSourceIds);
    return enabledDataSources.filter(ds => scoped.has(ds.id));
  }, [enabledDataSources, scopedDataSourceIds]);

  const suggestedRules = useMemo(() => {
    const scopedIds = new Set(scopedDataSources.map(ds => ds.id));
    return rules.filter(
      rule =>
        rule.state === 'suggested' &&
        scopedIds.has(rule.sourceDatasourceId) &&
        scopedIds.has(rule.targetDatasourceId),
    );
  }, [scopedDataSources, rules]);

  const { transitionMany } = useRelationshipRuleTransitions();
  const handleApproveMany = useCallback(
    (ruleIds: string[]) => transitionMany(ruleIds, 'approve'),
    [transitionMany],
  );
  const handleDismissMany = useCallback(
    (ruleIds: string[]) => transitionMany(ruleIds, 'dismiss'),
    [transitionMany],
  );

  const { suggestForAllDatasourceIds, lastRunSuppressed } =
    useRelationshipSuggestionActions();

  const handleGenerateForDataSources = useCallback(
    async (datasourceIds: string[]) => {
      setGenerating(true);
      try {
        await suggestForAllDatasourceIds(datasourceIds);
      } finally {
        setGenerating(false);
      }
    },
    [suggestForAllDatasourceIds],
  );

  // Generates for what's in scope, matching the drawer — there, the header
  // facet narrows the sources before generate-all ever sees them.
  const handleGenerateAll = useCallback(
    () => handleGenerateForDataSources(scopedDataSources.map(ds => ds.id)),
    [scopedDataSources, handleGenerateForDataSources],
  );

  const generateDialogDataSources = useMemo(
    () => scopedDataSources.map(ds => ({ id: ds.id, label: ds.name })),
    [scopedDataSources],
  );

  const datasourceLogos = useMemo(() => {
    const map = new Map<string, string>();
    for (const ds of enabledDataSources) {
      map.set(ds.id, ds.logoUrl);
    }
    return map;
  }, [enabledDataSources]);

  const actionsState = useSuggestedRulesPanelActions({
    suggestedRules,
    onApproveMany: handleApproveMany,
    onDismissMany: handleDismissMany,
  });

  const handleInlineSave = useCallback(
    async (rule: RelationshipRule, input: RelationshipRuleInput) => {
      try {
        return await saveRule({ input, existingRule: rule });
      } catch (saveError) {
        alertApi.post({
          message: `Failed to update rule: ${formatErrorString(saveError)}`,
          severity: 'error',
        });
        throw saveError;
      }
    },
    [saveRule, alertApi],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <EditorHeader
        title="Relationship Suggestions"
        icon={<Network className="size-5" />}
        backTo={PATHS.RELATIONSHIPS}
        saveState="none"
        actions={
          loading ? null : (
            <div className="flex items-center gap-2">
              <SuggestedRulesHeaderActions
                suggestedRules={suggestedRules}
                generating={generating}
                actionsState={actionsState}
                onGenerateAll={handleGenerateAll}
                dataSources={generateDialogDataSources}
                onGenerateForDataSources={handleGenerateForDataSources}
              />
              <DataSourceFacetFilter
                dataSources={enabledDataSources}
                value={scopedDataSourceIds}
                onChange={handleScopeChange}
                className="w-56"
              />
            </div>
          )
        }
      />
      {loading ? (
        <PageLoading label="Loading relationship suggestions..." />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <SuggestedRulesPanel
            suggestedRules={suggestedRules}
            highlightedRuleId={highlightedRuleId}
            datasourceLabels={datasourceLabels}
            datasourceLogos={datasourceLogos}
            suppressedSuggestions={lastRunSuppressed}
            onApproveMany={handleApproveMany}
            onDismissMany={handleDismissMany}
            onSuggestedRuleClick={ruleId => setExpandedRuleId(ruleId)}
            onSuggestedRuleHover={setHighlightedRuleId}
            actionsState={actionsState}
            expandedRuleId={expandedRuleId}
            onToggleRuleExpanded={ruleId =>
              setExpandedRuleId(current => (current === ruleId ? null : ruleId))
            }
            renderExpandedRule={(rule, rankShown) => (
              <SuggestionInlineReview
                rule={rule}
                rank={rankShown}
                rules={rules}
                sourceLabel={
                  datasourceLabels.get(rule.sourceDatasourceId) ??
                  rule.sourceDatasourceId
                }
                targetLabel={
                  datasourceLabels.get(rule.targetDatasourceId) ??
                  rule.targetDatasourceId
                }
                sourceFields={extractSchemaFields(
                  schemaByDatasourceId.get(rule.sourceDatasourceId)?.schema,
                )}
                targetFields={extractSchemaFields(
                  schemaByDatasourceId.get(rule.targetDatasourceId)?.schema,
                )}
                onSave={input => handleInlineSave(rule, input)}
                // Thread the row's list position so an expanded (careful)
                // review records the same rankShown a quick collapsed-card
                // approve/dismiss would have.
                onApprove={ruleId =>
                  actionsState.approveSuggestion(ruleId, rankShown)
                }
                onDismiss={ruleId =>
                  actionsState.dismissSuggestion(ruleId, rankShown)
                }
                onPreview={previewRule}
                onCollapse={() => setExpandedRuleId(null)}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}

export function RelationshipRuleEditPage() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const navigate = useNavigate();
  const alertApi = useAlert();
  const { saveRule, deleteRule, previewRule } = useRelationshipRuleMutations();
  const {
    dataSources,
    enabledDataSources,
    datasourceLabels,
    schemaByDatasourceId,
    rules,
    loading,
    error,
  } = useRelationshipsCatalog();

  const { approveSuggestion, dismissSuggestion } = useSuggestionReview();

  useEffect(() => {
    if (error) {
      alertApi.post({
        message: `Failed to load relationship rule: ${formatErrorString(error)}`,
        severity: 'error',
      });
    }
  }, [error, alertApi]);

  const rule = useMemo(
    () => rules.find(candidate => candidate.id === ruleId),
    [rules, ruleId],
  );
  const sourceDataSource = useMemo(
    () =>
      rule
        ? dataSources.find(ds => ds.id === rule.sourceDatasourceId)
        : undefined,
    [dataSources, rule],
  );
  const targetDataSource = useMemo(
    () =>
      rule
        ? dataSources.find(ds => ds.id === rule.targetDatasourceId)
        : undefined,
    [dataSources, rule],
  );
  const sourceFields = useMemo(
    () =>
      rule
        ? extractSchemaFields(
            schemaByDatasourceId.get(rule.sourceDatasourceId)?.schema,
          )
        : [],
    [schemaByDatasourceId, rule],
  );
  const targetFields = useMemo(
    () =>
      rule
        ? extractSchemaFields(
            schemaByDatasourceId.get(rule.targetDatasourceId)?.schema,
          )
        : [],
    [schemaByDatasourceId, rule],
  );

  const handleClose = useCallback(() => {
    navigate(PATHS.RELATIONSHIPS);
  }, [navigate]);

  const handleSave = useCallback(
    async (input: RelationshipRuleInput) => {
      if (!rule) {
        return undefined;
      }
      let saved: RelationshipRule;
      try {
        saved = await saveRule({ input, existingRule: rule });
      } catch (saveError) {
        alertApi.post({
          message: `Failed to update rule: ${formatErrorString(saveError)}`,
          severity: 'error',
        });
        throw saveError;
      }
      return saved;
    },
    [saveRule, alertApi, rule],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteRule(id);
      } catch (deleteError) {
        alertApi.post({
          message: `Failed to delete rule: ${formatErrorString(deleteError)}`,
          severity: 'error',
        });
        throw deleteError;
      }
    },
    [deleteRule, alertApi],
  );

  if (loading) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <EditorHeader
          title="Edit Relationship Rule"
          icon={<Network className="size-5" />}
          backTo={PATHS.RELATIONSHIPS}
        />
        <PageLoading label="Loading relationship rule..." />
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <EditorHeader
          title="Edit Relationship Rule"
          icon={<Network className="size-5" />}
          backTo={PATHS.RELATIONSHIPS}
        />
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
          Relationship rule not found.
        </div>
      </div>
    );
  }

  // The full-page editor edits any rule, suggestions included. A suggestion's
  // destructive action must DISMISS (mark it inactive, reviewReason
  // 'manual-dismiss' — Generate never revives it), matching every other
  // suggestion surface; a real rule's action is still a hard delete. Wiring the
  // two through the shared `onDelete`/`deleteLabel` is how the graph and inline
  // surfaces do the same thing. `dismissSuggestion` toasts its own failures.
  const isSuggestion = rule.state === 'suggested';

  return (
    <RelationshipRuleEditContent
      rule={rule}
      rules={rules}
      sourceLabel={
        sourceDataSource?.name ??
        datasourceLabels.get(rule.sourceDatasourceId) ??
        rule.sourceDatasourceId
      }
      targetLabel={
        targetDataSource?.name ??
        datasourceLabels.get(rule.targetDatasourceId) ??
        rule.targetDatasourceId
      }
      sourceLogoUrl={sourceDataSource?.logoUrl}
      targetLogoUrl={targetDataSource?.logoUrl}
      sourceFields={sourceFields}
      targetFields={targetFields}
      // The editor only draws enabled sources, so only offer "View in graph"
      // when both endpoints are enabled (matches the other entry points).
      viewableInGraph={
        enabledDataSources.some(ds => ds.id === rule.sourceDatasourceId) &&
        enabledDataSources.some(ds => ds.id === rule.targetDatasourceId)
      }
      onClose={handleClose}
      onSave={handleSave}
      onDelete={isSuggestion ? dismissSuggestion : handleDelete}
      deleteLabel={isSuggestion ? 'Dismiss' : 'Delete'}
      onApprove={approveSuggestion}
      onPreview={previewRule}
    />
  );
}

function RelationshipRuleEditContent({
  rule,
  rules,
  sourceLabel,
  targetLabel,
  sourceLogoUrl,
  targetLogoUrl,
  sourceFields,
  targetFields,
  viewableInGraph,
  onClose,
  onSave,
  onDelete,
  deleteLabel,
  onApprove,
  onPreview,
}: {
  rule: RelationshipRule;
  rules: RelationshipRule[];
  sourceLabel: string;
  targetLabel: string;
  sourceLogoUrl?: string;
  targetLogoUrl?: string;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  viewableInGraph: boolean;
  onClose: () => void;
  onSave: (
    input: RelationshipRuleInput,
  ) => Promise<RelationshipRule | undefined>;
  onDelete: (ruleId: string) => Promise<void>;
  /** Names the destructive action — "Dismiss" for a suggestion, "Delete" for
   *  a real rule. See RelationshipRuleEditPage for why they differ. */
  deleteLabel?: string;
  onApprove: (ruleId: string) => Promise<void>;
  onPreview: ComponentProps<typeof RelationshipRuleInspector>['onPreview'];
}) {
  const editor = useRelationshipRuleEditor({
    open: true,
    variant: 'page',
    sourceDatasourceId: rule.sourceDatasourceId,
    targetDatasourceId: rule.targetDatasourceId,
    sourceLabel,
    targetLabel,
    sourceFields,
    targetFields,
    existingRule: rule,
    existingRules: rules,
    onClose,
    onSave,
    onDelete,
    onApprove,
    onPreview,
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <EditorHeader
        title={
          rule.name?.trim()
            ? rule.name
            : rule.state === 'suggested'
              ? 'Review Suggested Rule'
              : 'Edit Relationship Rule'
        }
        icon={<Network className="size-5" />}
        backTo={PATHS.RELATIONSHIPS}
        actions={
          <div className="flex items-center gap-1">
            {viewableInGraph && (
              <Button asChild variant="outline" size="sm">
                <Link
                  to={relationshipBetween(
                    rule.sourceDatasourceId,
                    rule.targetDatasourceId,
                    rule.id,
                  )}
                >
                  <Waypoints className="size-4" />
                  View in graph
                </Link>
              </Button>
            )}
            <RelationshipRuleInspectorActions
              editor={editor}
              onClose={onClose}
              onApprove={onApprove}
              onDelete={onDelete}
              deleteLabel={deleteLabel}
            />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <RelationshipRuleInspector
          open
          container={null}
          variant="page"
          showHeader={false}
          editor={editor}
          sourceDatasourceId={rule.sourceDatasourceId}
          targetDatasourceId={rule.targetDatasourceId}
          sourceLabel={sourceLabel}
          targetLabel={targetLabel}
          sourceLogoUrl={sourceLogoUrl}
          targetLogoUrl={targetLogoUrl}
          sourceFields={sourceFields}
          targetFields={targetFields}
          existingRule={rule}
          existingRules={rules}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
          deleteLabel={deleteLabel}
          onApprove={onApprove}
          onPreview={onPreview}
        />
      </div>
    </div>
  );
}
