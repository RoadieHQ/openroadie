import { useCallback, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@roadiehq/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@roadiehq/ui/drawer';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import { useAlert, useDatastore } from '../../../api';
import type {
  DatastoreObjectWithRelationships,
  ExampleRelationshipPatternCandidate,
  RelationshipRule,
  RelationshipRuleInput,
} from '../../../api/datastore/datastore-client';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import { ExampleObjectPicker } from '../objects/example-object-picker';
import type { DataSourceItem } from '../types';
import { useDatastoreSchemas } from '../use-datastore-schemas';
import { useRelationshipRules } from '../use-relationship-rules';
import { RelationshipRuleForm, RuleSummary } from './relationship-rule-form';
import { RelationshipPlayground } from './relationship-playground';
import { useRelationshipRuleEditor } from './use-relationship-rule-editor';
import { useRelationshipRuleMutations } from './use-relationship-rule-mutations';
import { extractSchemaFields, type SchemaField } from './schema-field-utils';

interface ExampleRelationshipWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataSources: DataSourceItem[];
  sourceDatasourceId: string;
  sourceObjectId: string;
  onRelationshipCreated?: () => void | Promise<void>;
}

interface ExampleSelection {
  sourceDatasourceId: string;
  sourceObjectId: string;
  targetDatasourceId: string;
  targetObjectId: string;
  sourceObject: DatastoreObjectWithRelationships;
  targetObject: DatastoreObjectWithRelationships;
}

const STEPS = ['Pick example', 'Propose pattern', 'Review & create'] as const;

function schemaFieldsFromObject(object: unknown): SchemaField[] {
  if (typeof object !== 'object' || object === null || Array.isArray(object)) {
    return [];
  }
  return Object.entries(object).map(([name, value]) => ({
    name,
    type: Array.isArray(value) ? 'array' : typeof value,
    rawValue: value,
  }));
}

function dataSourceLabel(dataSources: DataSourceItem[], id: string): string {
  return dataSources.find(ds => ds.id === id)?.name ?? id;
}

export function ExampleRelationshipWizard({
  open,
  onOpenChange,
  dataSources,
  sourceDatasourceId,
  sourceObjectId,
  onRelationshipCreated,
}: ExampleRelationshipWizardProps) {
  const api = useDatastore();
  const alertApi = useAlert();
  const { saveRule, previewRule } = useRelationshipRuleMutations();
  const { rules } = useRelationshipRules(open);
  const { schemas } = useDatastoreSchemas(open);
  const [step, setStep] = useState(0);
  const [selection, setSelection] = useState<ExampleSelection | null>(null);
  const [candidates, setCandidates] = useState<
    ExampleRelationshipPatternCandidate[]
  >([]);
  const [selectedIndexes, setSelectedIndexes] = useState<ReadonlySet<number>>(
    new Set(),
  );

  // "Infer" is a user-triggered generation action. React Query's keyed
  // mutation state supersedes the old request-id generation guard: starting a
  // new infer resets the mutation, so a slower prior call can't repopulate a
  // pattern the user has since cleared or changed (candidates are only written
  // from the per-call onSuccess callback below).
  const inferMutation = useMutation({
    mutationFn: (nextSelection: ExampleSelection) =>
      api.inferExampleRelationshipPattern({
        sourceDatasourceId: nextSelection.sourceDatasourceId,
        sourceObjectId: nextSelection.sourceObjectId,
        targetDatasourceId: nextSelection.targetDatasourceId,
        targetObjectId: nextSelection.targetObjectId,
      }),
  });
  const {
    mutate: inferMutate,
    reset: resetInfer,
    isPending: inferLoading,
    error: inferErrorObj,
  } = inferMutation;
  const inferError = inferErrorObj
    ? inferErrorObj instanceof Error
      ? inferErrorObj.message
      : 'Inference failed'
    : null;

  const resetInferredPattern = useCallback(() => {
    setCandidates([]);
    setSelectedIndexes(new Set());
    resetInfer();
  }, [resetInfer]);

  const toggleCandidate = (index: number) =>
    setSelectedIndexes(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });

  // A candidate pair the user can only re-create is noise — a field-matching
  // rule with the same source/target already generalizes it, so it's shown
  // struck out and can't be selected.
  const coveredIndexes = useMemo(() => {
    const covered = new Set<number>();
    if (!selection) {
      return covered;
    }
    candidates.forEach((candidate, index) => {
      const exists = rules.some(
        rule =>
          (rule.strategy ?? 'field-matching') === 'field-matching' &&
          rule.sourceDatasourceId === selection.sourceDatasourceId &&
          rule.targetDatasourceId === selection.targetDatasourceId &&
          rule.sourceFieldExpression === candidate.sourceFieldExpression &&
          rule.targetFieldExpression === candidate.targetFieldExpression,
      );
      if (exists) {
        covered.add(index);
      }
    });
    return covered;
  }, [candidates, rules, selection]);

  const selectedCandidates = useMemo(
    () =>
      [...selectedIndexes]
        .sort((a, b) => a - b)
        .map(index => candidates.at(index))
        .filter(
          (c): c is ExampleRelationshipPatternCandidate => c !== undefined,
        ),
    [selectedIndexes, candidates],
  );
  const selectedCandidate = selectedCandidates.at(0);
  const sourceLabel = selection
    ? dataSourceLabel(dataSources, selection.sourceDatasourceId)
    : dataSourceLabel(dataSources, sourceDatasourceId);
  const targetLabel = selection
    ? dataSourceLabel(dataSources, selection.targetDatasourceId)
    : sourceLabel;

  const sourceFields = useMemo(() => {
    if (!selection) {
      return [];
    }
    const schema = schemas.find(
      s => s.datasourceId === selection.sourceDatasourceId,
    );
    const schemaFields = schema ? extractSchemaFields(schema.schema) : [];
    return schemaFields.length > 0
      ? schemaFields
      : schemaFieldsFromObject(selection.sourceObject.object);
  }, [schemas, selection]);

  const targetFields = useMemo(() => {
    if (!selection) {
      return [];
    }
    const schema = schemas.find(
      s => s.datasourceId === selection.targetDatasourceId,
    );
    const schemaFields = schema ? extractSchemaFields(schema.schema) : [];
    return schemaFields.length > 0
      ? schemaFields
      : schemaFieldsFromObject(selection.targetObject.object);
  }, [schemas, selection]);

  const editor = useRelationshipRuleEditor({
    open: open && Boolean(selection && selectedCandidate),
    sourceDatasourceId: selection?.sourceDatasourceId ?? sourceDatasourceId,
    targetDatasourceId: selection?.targetDatasourceId ?? sourceDatasourceId,
    sourceLabel,
    targetLabel,
    sourceFields,
    targetFields,
    existingRules: rules,
    initialSourceField: selectedCandidate?.sourceFieldExpression,
    initialTargetField: selectedCandidate?.targetFieldExpression,
    onClose: () => onOpenChange(false),
    onSave: async (input: RelationshipRuleInput) => {
      let saved: RelationshipRule | undefined;
      try {
        // The editor's own fields carry the first selected pair; each further
        // selected candidate becomes its own rule with the same relationship
        // settings but its inferred field pair. Direct edges belong to the
        // first pair (the editor's own), so its rule is returned for provenance.
        saved = await saveRule({ input });
        for (const candidate of selectedCandidates.slice(1)) {
          await saveRule({
            input: {
              ...input,
              name: `${candidate.sourceFieldExpression} → ${candidate.targetFieldExpression}`,
              sourceFieldExpression: candidate.sourceFieldExpression,
              targetFieldExpression: candidate.targetFieldExpression,
            },
          });
        }
      } catch (error) {
        alertApi.post({
          message: `Failed to create rule: ${formatErrorString(error)}`,
          severity: 'error',
        });
        throw error;
      }
      await onRelationshipCreated?.();
      return saved;
    },
    onPreview: previewRule,
  });

  const handleInfer = (nextSelection: ExampleSelection) => {
    setSelection(nextSelection);
    setStep(1);
    setSelectedIndexes(new Set());
    setCandidates([]);
    inferMutate(nextSelection, {
      onSuccess: result => setCandidates(result.candidates),
    });
  };

  const close = () => {
    onOpenChange(false);
    setStep(0);
    setSelection(null);
    setCandidates([]);
    setSelectedIndexes(new Set());
    resetInfer();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={value => (value ? onOpenChange(true) : close())}
    >
      <DrawerContent className="max-h-[92vh]">
        <DrawerHeader className="border-b border-border px-4 py-3">
          <DrawerTitle>Create relationship from example</DrawerTitle>
          <DrawerDescription className="sr-only">
            Pick two objects, choose an inferred field pattern, preview matches,
            and create the relationship rule.
          </DrawerDescription>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {STEPS.map((label, index) => (
              <Button
                key={label}
                type="button"
                variant="outline"
                className={cn(
                  'h-auto rounded border px-2 py-1 text-xs',
                  index === step
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                )}
                onClick={() => {
                  if (index === 0) {
                    resetInferredPattern();
                  }
                  setStep(index);
                }}
                disabled={index > 0 && candidates.length === 0}
              >
                {label}
              </Button>
            ))}
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {step === 0 && (
            <ExampleObjectPicker
              dataSources={dataSources}
              initialSourceDatasourceId={sourceDatasourceId}
              initialSourceObjectId={sourceObjectId}
              candidates={candidates}
              inferLoading={inferLoading}
              onInfer={handleInfer}
              onExampleChange={resetInferredPattern}
            />
          )}

          {step === 1 && (
            <div className="space-y-3">
              {inferLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-3" />
                  Proposing fields
                </div>
              )}
              {inferError && (
                <div className="text-xs text-destructive">{inferError}</div>
              )}
              {!inferLoading && candidates.length === 0 && (
                <div className="rounded-md border border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  No shared field values were found for this example pair.
                </div>
              )}
              <div className="grid gap-2">
                {candidates.map((candidate, index) => {
                  const covered = coveredIndexes.has(index);
                  return (
                    <Button
                      key={`${candidate.sourceFieldExpression}|${candidate.targetFieldExpression}`}
                      type="button"
                      variant={
                        selectedIndexes.has(index) ? 'default' : 'outline'
                      }
                      className="h-auto justify-between gap-3 px-3 py-2 text-left"
                      disabled={covered}
                      onClick={() => toggleCandidate(index)}
                    >
                      <span className="min-w-0 truncate text-xs">
                        <span className="font-mono">
                          {candidate.sourceFieldExpression}
                        </span>{' '}
                        {'-> '}
                        <span className="font-mono">
                          {candidate.targetFieldExpression}
                        </span>
                      </span>
                      <span className="shrink-0 text-2xs opacity-80">
                        {covered ? 'Rule exists' : candidate.matchedValue}
                      </span>
                    </Button>
                  );
                })}
              </div>
              {candidates.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Select one or more field pairs — each becomes its own rule.
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!selectedCandidate}
                  onClick={() => setStep(2)}
                >
                  Review matches
                </Button>
              </div>
            </div>
          )}

          {step >= 2 && selection && selectedCandidate && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-card/60 px-3 py-2">
                <RuleSummary
                  sourceLabel={sourceLabel}
                  targetLabel={targetLabel}
                  sourceFieldExpression={editor.sourceFieldExpression}
                  targetFieldExpression={editor.targetFieldExpression}
                  relationshipType={editor.relationshipType}
                  reciprocalRelationshipType={editor.reciprocalRelationshipType}
                  matchStrategy={editor.matchStrategy}
                  strategy={editor.strategy}
                  integrationConfig={editor.integrationConfig}
                />
              </div>
              <RelationshipRuleForm
                sourceLabel={sourceLabel}
                targetLabel={targetLabel}
                sourceFields={sourceFields}
                targetFields={targetFields}
                editor={editor}
                previewSection={
                  <RelationshipPlayground
                    editor={editor}
                    sourceLabel={sourceLabel}
                    targetLabel={targetLabel}
                    hasPreview
                    exampleSourceObjectId={selection.sourceObjectId}
                  />
                }
              />
              <div className="flex flex-col items-end gap-2">
                {editor.saveBlockedReason && (
                  <div className="text-xs text-muted-foreground">
                    {editor.saveBlockedReason}
                  </div>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={!editor.canSave || editor.busy}
                  onClick={editor.handleSave}
                >
                  {editor.saving && <Spinner className="mr-1 size-3" />}
                  {selectedCandidates.length > 1
                    ? `Create ${selectedCandidates.length} rules & apply`
                    : 'Create rule & apply'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
