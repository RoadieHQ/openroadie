import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SubmitErrorHandler } from 'react-hook-form';
import {
  RotateCcw,
  History,
  X,
  Copy,
  FlaskConical,
  Hash,
  Power,
  Trash2,
} from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Badge } from '@roadiehq/ui/badge';
import { Label } from '@roadiehq/ui/label';
import { Input } from '@roadiehq/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { OutlinedTextarea } from '@roadiehq/ui/outlined-textarea';
import { StatusDot } from '@roadiehq/ui/status-indicator';
import {
  EntityEditorHeader,
  EntityEditorShell,
  useEditorDraft,
  workspaceEditorDraftKey,
  useZodForm,
} from '../../common';
import { slugify } from '@roadiehq/actions-common';
import {
  useActions as useActionsApi,
  useAlert,
  type ActionInput,
  type ActionParam,
  type ActionStep,
  type ActionVersion,
} from '../../../api';
import {
  actionDetailQuery,
  actionVersionsQuery,
  invalidationKeys,
} from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { useIntegrations } from '../../integrations/use-integrations';
import { StepList, makeEmptyStep } from './step-list';
import { ActionInputsNode } from './action-inputs-node';
import { ActionRunPanel, INPUTS_STEP_ID } from './action-run-panel';
import { useActionTestRun } from './use-action-test-run';
import { VersionHistory } from './version-history';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { useReferenceUsage } from '../../capabilities/use-reference-usage';
import { useReferenceRename } from '../../capabilities/use-reference-rename';
import { ReferenceUsageWarning } from '../../capabilities/reference-usage-warning';
import {
  UnreferenceableSlugIcon,
  slugTriggerTooltip,
} from '../../capabilities/unreferenceable-slug';
import {
  PipelineEditorLayout,
  EditorActionsMenu,
  type EditorActionMenuItem,
} from '../../common/pipeline-editor';
import {
  actionEditorSchema,
  type ActionEditorValues,
} from './action-editor-schema';

interface DraftFields {
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  parameters: ActionParam[];
  steps: ActionStep[];
}

const EMPTY_DRAFT: DraftFields = {
  name: '',
  slug: '',
  description: '',
  enabled: true,
  parameters: [],
  steps: [makeEmptyStep([])],
};

/** Placeholder shown in the editable header title before the action is named. */
const UNTITLED_ACTION_LABEL = 'Untitled action';

interface StoredDraft {
  draft: DraftFields;
  slugEdited: boolean;
}

function draftStorageKey(actionId: string | undefined): string {
  return workspaceEditorDraftKey('actions', actionId);
}

/** A draft persisted before the multi-step shape (single request). */
interface LegacyDraftFields {
  integrationId?: string;
  request?: ActionStep['request'];
}

// Parses the JSON already read from sessionStorage by useEditorDraft.
function parseStoredDraft(raw: unknown): StoredDraft | null {
  const parsed = raw as StoredDraft | null;
  if (!parsed) return null;
  if (!Array.isArray(parsed.draft?.steps)) {
    // Convert pre-multi-step drafts instead of dropping in-flight edits
    // (mirrors the DB migration).
    const legacy = parsed.draft as DraftFields & LegacyDraftFields;
    if (!legacy?.request || typeof legacy.request !== 'object') return null;
    const { integrationId, request, ...rest } = legacy;
    parsed.draft = {
      ...rest,
      steps: [{ id: 'step1', integrationId: integrationId ?? '', request }],
    };
  }
  return parsed;
}

function stepHasContent(step: ActionStep): boolean {
  return Boolean(
    step.integrationId ||
    step.request.path.trim() ||
    step.request.body.trim() ||
    step.request.headers.length > 0,
  );
}

function isMeaningfulDraft(draft: DraftFields): boolean {
  if (draft.name.trim()) return true;
  if (draft.slug.trim()) return true;
  if (draft.description.trim()) return true;
  if (draft.parameters.length > 0) return true;
  if (draft.steps.length > 1) return true;
  if (draft.steps.some(stepHasContent)) return true;
  if (!draft.enabled) return true;
  return false;
}

function draftFromAction(source: {
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  parameters: ActionParam[];
  steps: ActionStep[];
}): DraftFields {
  return {
    name: source.name,
    slug: source.slug,
    description: source.description,
    enabled: source.enabled,
    parameters: source.parameters,
    steps: source.steps,
  };
}

function resolveNewDraftSeed(
  duplicateSource: DraftFields | undefined,
  stored: StoredDraft | null,
): {
  draft: DraftFields;
  slugEdited: boolean;
  pendingDuplicate: DraftFields | null;
} {
  if (duplicateSource && stored && isMeaningfulDraft(stored.draft)) {
    return {
      draft: stored.draft,
      slugEdited: stored.slugEdited,
      pendingDuplicate: duplicateSource,
    };
  }
  if (duplicateSource) {
    return {
      draft: duplicateSource,
      slugEdited: false,
      pendingDuplicate: null,
    };
  }
  return {
    draft:
      stored && isMeaningfulDraft(stored.draft) ? stored.draft : EMPTY_DRAFT,
    slugEdited:
      stored && isMeaningfulDraft(stored.draft) ? stored.slugEdited : false,
    pendingDuplicate: null,
  };
}

export function ActionEditor() {
  const { actionId } = useParams<{ actionId: string }>();
  return <ActionEditorForm key={actionId ?? 'new'} />;
}

function ActionEditorForm() {
  const { actionId } = useParams<{ actionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const duplicateSource = (
    location.state as { duplicateFrom?: DraftFields } | null
  )?.duplicateFrom;
  const storageKey = draftStorageKey(actionId);
  const draftStore = useEditorDraft(storageKey, parseStoredDraft);
  const actionsApi = useActionsApi();
  const alertApi = useAlert();
  const { integrations, refetch: refetchIntegrations } = useIntegrations();
  // Integrations created inline through the selector — the fetched list lags
  // behind until the refetch lands, and a just-created id must not trip the
  // "no longer available" warning.
  const [inlineIntegrationIds, setInlineIntegrationIds] = useState<string[]>(
    [],
  );

  const isNew = actionId === 'new';

  const enabled = !isNew && !!actionId;
  const actionQuery = useQuery({
    ...actionDetailQuery(actionsApi, actionId ?? ''),
    enabled,
  });
  // `actionDetailQuery` resolves to null on a 404 (React Query forbids
  // undefined data); collapse both to undefined for the "not found" / seed
  // logic below.
  const action = actionQuery.data ?? undefined;
  const loading = actionQuery.isLoading;
  const error = actionQuery.error;

  const versionsQuery = useQuery({
    ...actionVersionsQuery(actionsApi, actionId ?? ''),
    enabled,
  });
  const versionsData = versionsQuery.data;
  const versionsLoading = versionsQuery.isLoading;

  const restoreMutation = useInvalidatingMutation({
    mutationFn: (version: number) => {
      if (!actionId || isNew) {
        throw new Error('Cannot restore a version of a new action');
      }
      return actionsApi.restoreVersion(actionId, version);
    },
    invalidates: actionId ? invalidationKeys.actionSaved(actionId) : [],
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: (input: ActionInput) => actionsApi.create(input),
    invalidates: invalidationKeys.actionSaved(),
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: (input: ActionInput) => {
      if (!actionId || isNew) {
        throw new Error('Cannot update a new action');
      }
      return actionsApi.update(actionId, input);
    },
    invalidates: actionId ? invalidationKeys.actionSaved(actionId) : [],
  });

  const deleteMutation = useInvalidatingMutation({
    mutationFn: () => {
      if (!actionId || isNew) {
        throw new Error('Cannot delete a new action');
      }
      return actionsApi.delete(actionId);
    },
    invalidates: invalidationKeys.actionSaved(),
  });

  const newDraftSeed = useMemo(
    () =>
      isNew ? resolveNewDraftSeed(duplicateSource, draftStore.read()) : null,
    [isNew, duplicateSource, draftStore],
  );

  const form = useZodForm({
    schema: actionEditorSchema,
    defaultValues: newDraftSeed?.draft ?? EMPTY_DRAFT,
  });
  const { isSubmitting, isDirty, isSubmitted, errors } = form.formState;
  const values = form.watch();
  const draft: DraftFields = values;

  // While creating, the slug auto-tracks the name until the user edits it.
  const [slugEdited, setSlugEdited] = useState(
    () => newDraftSeed?.slugEdited ?? false,
  );
  const [pendingDuplicate, setPendingDuplicate] = useState<DraftFields | null>(
    () => newDraftSeed?.pendingDuplicate ?? null,
  );
  const [viewingVersion, setViewingVersion] = useState<ActionVersion | null>(
    null,
  );
  const [showVersions, setShowVersions] = useState(false);
  const testRun = useActionTestRun({
    parameters: draft.parameters,
    steps: draft.steps,
  });
  const [inputsExpanded, setInputsExpanded] = useState(false);
  const [slugPopoverOpen, setSlugPopoverOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Capabilities that would be left with a broken `@action:<slug>` token.
  const { getReferencedTargets, loading: usageLoading } = useReferenceUsage({
    skip: !deleteDialogOpen,
  });
  // The slug rides the whole-form save, so the guard must be loaded whenever
  // the form can be submitted — not just while the slug popover is open.
  const renameGuard = useReferenceRename();
  const referencedDeleteTargets = useMemo(
    () =>
      getReferencedTargets([
        {
          type: 'action',
          name: draft.name || 'this action',
          slug: action?.slug,
        },
      ]),
    [getReferencedTargets, draft.name, action?.slug],
  );

  // The panel opens on the first request step. A run moves the selection to
  // the last step it reached; resetting the result falls back to the first
  // step rather than leaving a stale step highlighted. Validation errors still
  // jump to Inputs so the test values can be fixed there.
  const firstStepId = draft.steps[0]?.id ?? null;
  const [selectedResultStepId, setSelectedResultStepId] = useState<
    string | null
  >(null);

  useEffect(() => {
    const last = testRun.result?.steps.at(-1);
    setSelectedResultStepId(last?.id ?? null);
  }, [testRun.result]);

  // Surface a failed-validation message where it can be fixed: on the Inputs step.
  useEffect(() => {
    if (testRun.validationError) setSelectedResultStepId(INPUTS_STEP_ID);
  }, [testRun.validationError]);

  const clearDuplicateNavigationState = useCallback(() => {
    navigate(location.pathname, { replace: true, state: null });
  }, [navigate, location.pathname]);

  const handleConfirmDuplicate = useCallback(() => {
    if (!pendingDuplicate) return;
    form.reset(pendingDuplicate);
    setSlugEdited(false);
    setPendingDuplicate(null);
    clearDuplicateNavigationState();
  }, [pendingDuplicate, form, clearDuplicateNavigationState]);

  const handleCancelDuplicate = useCallback(() => {
    setPendingDuplicate(null);
    clearDuplicateNavigationState();
  }, [clearDuplicateNavigationState]);

  const duplicateSourceRef = useRef(duplicateSource);

  useEffect(() => {
    if (!isNew || !duplicateSource) {
      duplicateSourceRef.current = duplicateSource;
      return;
    }
    if (duplicateSourceRef.current === duplicateSource) return;
    duplicateSourceRef.current = duplicateSource;

    const stored = draftStore.read();
    if (stored && isMeaningfulDraft(stored.draft)) {
      setPendingDuplicate(duplicateSource);
      form.reset(stored.draft);
      setSlugEdited(stored.slugEdited);
      return;
    }

    setPendingDuplicate(null);
    form.reset(duplicateSource);
    setSlugEdited(false);
  }, [duplicateSource, isNew, draftStore, form]);

  const seedDraftFromAction = useCallback(
    (loaded: NonNullable<typeof action>) => {
      const stored = draftStore.read();
      if (stored && isMeaningfulDraft(stored.draft)) {
        // Keep the server definition as the baseline (defaults) so the form is
        // dirty against it, then layer the unsaved draft on top.
        form.reset(draftFromAction(loaded));
        form.reset(stored.draft, { keepDefaultValues: true });
        setSlugEdited(stored.slugEdited);
      } else {
        if (stored) draftStore.clear();
        form.reset(draftFromAction(loaded));
      }
    },
    [draftStore, form],
  );

  const seededActionIdRef = useRef<string | undefined>(undefined);
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!action || viewingVersion || !actionId) return;
    if (seededActionIdRef.current === actionId) return;
    seededActionIdRef.current = actionId;
    seedDraftFromAction(action);
    setSeeded(true);
  }, [action, actionId, viewingVersion, seedDraftFromAction]);

  useEffect(() => {
    // Skip while viewing a historical version or before an existing action has
    // seeded; persist a meaningful new-or-dirty draft; otherwise (reverted to
    // the saved value) clear any stale draft so it isn't restored next visit.
    const notReady = viewingVersion !== null || (!isNew && !seeded);
    draftStore.persist(
      { draft, slugEdited } satisfies StoredDraft,
      (isNew || isDirty) && isMeaningfulDraft(draft),
      notReady,
    );
    // `draft` is rebuilt each render; depend on its fields so this only runs on
    // an actual value change, not every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    values.name,
    values.slug,
    values.description,
    values.enabled,
    values.parameters,
    values.steps,
    slugEdited,
    isDirty,
    isNew,
    viewingVersion,
    seeded,
    draftStore,
  ]);

  const handleStepsChange = useCallback(
    (steps: ActionStep[]) => {
      form.setValue('steps', steps, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [form],
  );

  const handleParametersChange = useCallback(
    (parameters: ActionParam[]) => {
      form.setValue('parameters', parameters, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [form],
  );

  const handleInlineIntegrationCreated = useCallback(
    (integrationId: string) => {
      setInlineIntegrationIds(prev => [...prev, integrationId]);
      refetchIntegrations();
    },
    [refetchIntegrations],
  );

  const readOnly = !!viewingVersion;

  const handleDuplicate = () => {
    navigate('/actions/new', {
      state: {
        duplicateFrom: {
          ...draft,
          name: draft.name ? `${draft.name} (copy)` : 'Untitled (copy)',
          slug: '',
        } satisfies DraftFields,
      },
    });
  };

  const handleDelete = async () => {
    if (!actionId || isNew) return;
    try {
      await deleteMutation.mutateAsync();
      draftStore.clear();
      alertApi.post({ message: 'Action deleted', severity: 'success' });
      navigate('/actions', { replace: true });
    } catch (e: unknown) {
      alertApi.post({
        message: e instanceof Error ? e.message : 'Failed to delete action',
        severity: 'error',
      });
    }
  };

  const handleInvalidSave: SubmitErrorHandler<
    ActionEditorValues
  > = fieldErrors => {
    const message =
      fieldErrors.name?.message ??
      // The slug lives in a popover that is closed on submit, so its inline
      // FormMessage is invisible — the toast is the only way to see it.
      fieldErrors.slug?.message ??
      fieldErrors.steps?.message ??
      fieldErrors.parameters?.message ??
      'Fix the highlighted errors before saving';
    alertApi.post({ message, severity: 'error' });
  };

  const handleSave = form.handleSubmit(async submitted => {
    const payload: ActionInput = {
      name: submitted.name.trim(),
      description: submitted.description.trim(),
      enabled: submitted.enabled,
      parameters: submitted.parameters,
      steps: submitted.steps,
      ...(submitted.slug.trim() ? { slug: submitted.slug.trim() } : {}),
    };

    const commit = async () => {
      if (isNew) {
        await createMutation.mutateAsync(payload);
      } else if (actionId) {
        await updateMutation.mutateAsync(payload);
      }
    };
    // Navigation is deferred so the editor stays mounted while any reference
    // rewrites run — unmounting mid-rewrite loses their error reporting.
    const finish = () => {
      draftStore.clear();
      alertApi.post({
        message: isNew ? 'Action created' : 'Action saved',
        severity: 'success',
      });
      navigate('/actions', { replace: true });
    };

    // The previous slug comes from the loaded action, never form state:
    // auto-slugify writes the field with `shouldDirty`, so `dirtyFields.slug`
    // can't distinguish a real rename.
    const nextSlug = submitted.slug.trim();
    if (
      !isNew &&
      renameGuard.interceptRename({
        type: 'action',
        fromSlug: action?.slug,
        toSlug: nextSlug,
        commit,
        onComplete: finish,
      })
    ) {
      return;
    }

    try {
      await commit();
      finish();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save';
      alertApi.post({ message, severity: 'error' });
    }
  }, handleInvalidSave);

  const handleViewVersion = (version: ActionVersion) => {
    setViewingVersion(version);
    form.reset(draftFromAction(version));
  };

  const handleExitVersionView = () => {
    setViewingVersion(null);
    if (action) {
      seedDraftFromAction(action);
    }
  };

  const handleRestoreVersion = async (version: number) => {
    if (!actionId || isNew) return;
    try {
      const restored = await restoreMutation.mutateAsync(version);
      draftStore.clear();
      setViewingVersion(null);
      form.reset(draftFromAction(restored));
      alertApi.post({
        message: `Restored version ${version}`,
        severity: 'success',
      });
    } catch (e: unknown) {
      alertApi.post({
        message: e instanceof Error ? e.message : 'Failed to restore version',
        severity: 'error',
      });
    }
  };

  const versions = versionsData?.items ?? [];
  const selectedIntegrationIds = draft.steps
    .map(s => s.integrationId)
    .filter(Boolean);
  const unknownIntegration = selectedIntegrationIds.some(
    id =>
      !integrations.some(i => i.id === id) &&
      !inlineIntegrationIds.includes(id),
  );
  const allStepsHaveIntegration = draft.steps.every(s => s.integrationId);

  if (error) {
    return (
      <EntityEditorShell>
        <EntityEditorHeader section="actions" title="Action" />
        <div className="flex flex-1 items-center justify-center text-sm text-destructive">
          {error.message}
        </div>
      </EntityEditorShell>
    );
  }

  if ((loading || (!seeded && !!action)) && !isNew) {
    return (
      <EntityEditorShell>
        <EntityEditorHeader section="actions" title="Action" />
        <div className="flex flex-1 items-center justify-center">
          <div className="motion-icon-spin size-6 rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </EntityEditorShell>
    );
  }

  if (!action && !isNew) {
    return (
      <EntityEditorShell>
        <EntityEditorHeader section="actions" title="Action" />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Action not found
        </div>
      </EntityEditorShell>
    );
  }

  const titleText = draft.name.trim() ? draft.name : UNTITLED_ACTION_LABEL;

  // The header "⋯" menu, mirroring the data-source editor's actions menu.
  const actionMenuItems: EditorActionMenuItem[] = [
    {
      icon: <Power />,
      label: draft.enabled ? 'Disable' : 'Enable',
      tooltip: 'Exposed to MCP / agents when enabled',
      onSelect: () =>
        form.setValue('enabled', !draft.enabled, { shouldDirty: true }),
    },
    ...(isNew
      ? []
      : [
          {
            icon: <History />,
            label: 'History',
            separatorBefore: true,
            onSelect: () => setShowVersions(true),
          },
          {
            icon: <Copy />,
            label: 'Duplicate',
            onSelect: handleDuplicate,
          },
          {
            icon: <Trash2 />,
            label: 'Delete',
            destructive: true,
            separatorBefore: true,
            onSelect: () => setDeleteDialogOpen(true),
          },
        ]),
  ];

  const parametersError = errors.parameters?.message;

  // Name, slug, description, and the MCP-enabled toggle live in the header
  // (data-source parity). Description stays in the slug popover as a textarea
  // so multiline MCP descriptions remain editable; the header shows a preview.

  // Committed on blur/Enter by the editable title. Guard the placeholder so
  // dismissing an untouched title on a new action doesn't save the placeholder
  // as the name.
  const handleTitleChange = (value: string) => {
    const next =
      value === UNTITLED_ACTION_LABEL && !draft.name.trim() ? '' : value;
    form.setValue('name', next, { shouldDirty: true, shouldValidate: true });
    if (isNew && !slugEdited) {
      form.setValue('slug', slugify(next), { shouldDirty: true });
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Form {...form}>
        <PipelineEditorLayout
          panelWidthStorageKey="actions-editor.details-panel-width"
          detailsPanelOpen={!viewingVersion}
          detailsPanel={
            <ActionRunPanel
              steps={draft.steps}
              integrations={integrations}
              inputText={testRun.inputText}
              onInputTextChange={testRun.setInputText}
              onResetInputs={testRun.resetInputs}
              validationError={testRun.validationError}
              disabled={readOnly}
              result={testRun.result}
              running={testRun.running}
              selectedStepId={selectedResultStepId ?? firstStepId}
              onSelectStep={setSelectedResultStepId}
            />
          }
          canvas={
            <fieldset disabled={isSubmitting} className="contents">
              <ActionInputsNode
                parameters={draft.parameters}
                onParametersChange={handleParametersChange}
                disabled={readOnly}
                expanded={inputsExpanded}
                onToggle={() => setInputsExpanded(v => !v)}
                error={isSubmitted ? parametersError : undefined}
              />

              <StepList
                steps={draft.steps}
                integrations={integrations}
                disabled={readOnly}
                onChange={handleStepsChange}
                onIntegrationCreated={handleInlineIntegrationCreated}
                autoExpandFirstStep
                editorResetKey={
                  viewingVersion
                    ? `view:${viewingVersion.version}`
                    : `edit:${action?.currentVersion ?? 'new'}`
                }
                running={testRun.running}
                runResult={testRun.result}
              />
              {unknownIntegration && (
                <p className="mt-2 text-xs text-destructive">
                  A selected integration is no longer available. Pick another
                  before saving.
                </p>
              )}
            </fieldset>
          }
          header={
            <EntityEditorHeader
              section="actions"
              title={titleText}
              editable={!viewingVersion}
              onTitleChange={handleTitleChange}
              description={draft.description}
              titleAdornment={
                viewingVersion ? undefined : (
                  <Popover
                    open={slugPopoverOpen}
                    onOpenChange={setSlugPopoverOpen}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto gap-1.5 px-1.5 py-0 font-mono text-2xs"
                            data-testid="action-slug-trigger"
                          >
                            <Hash className="size-3.5" />
                            {draft.slug || 'slug'}
                            <UnreferenceableSlugIcon
                              type="action"
                              slug={draft.slug}
                            />
                          </Button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent>
                        {slugTriggerTooltip(
                          'action',
                          draft.slug,
                          'Edit slug and description',
                        )}
                      </TooltipContent>
                    </Tooltip>
                    <PopoverContent align="start" className="w-80 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="action-slug">Slug</Label>
                        <FormField
                          control={form.control}
                          name="slug"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  {...field}
                                  id="action-slug"
                                  placeholder="e.g., create-issue"
                                  onChange={e => {
                                    setSlugEdited(true);
                                    field.onChange(e);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <p className="text-xs text-muted-foreground">
                          Reference this action from MCP by its slug.
                        </p>
                      </div>
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <OutlinedTextarea
                                label="Description"
                                disabled={readOnly}
                                className="min-h-[72px]"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </PopoverContent>
                  </Popover>
                )
              }
              saveState={viewingVersion ? 'none' : 'manual'}
              isDirty={isDirty}
              saving={isSubmitting}
              onSave={() => void handleSave()}
              saveLabel={isNew ? 'Create' : 'Save'}
              saveDisabled={!isNew && !isDirty}
              actions={
                viewingVersion ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      Viewing v{viewingVersion.version}
                    </Badge>
                    {action &&
                      viewingVersion.version !== action.currentVersion && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleRestoreVersion(viewingVersion.version)
                          }
                          disabled={restoreMutation.isPending}
                        >
                          <RotateCcw className="size-4" />
                          {restoreMutation.isPending
                            ? 'Restoring...'
                            : 'Restore'}
                        </Button>
                      )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleExitVersionView}
                    >
                      <X className="size-4" />
                      Exit
                    </Button>
                  </div>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="flex shrink-0 items-center gap-1.5"
                        data-testid="action-enabled-indicator"
                      >
                        <StatusDot
                          tone={draft.enabled ? 'success' : 'neutral'}
                          className="size-1.5"
                        />
                        <span className="text-2xs font-medium text-muted-foreground">
                          {draft.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {draft.enabled
                        ? 'Exposed to MCP clients. Disable from the ⋯ menu.'
                        : 'Hidden from MCP clients. Enable from the ⋯ menu.'}
                    </TooltipContent>
                  </Tooltip>
                )
              }
              trailingActions={
                viewingVersion ? undefined : (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={testRun.run}
                            disabled={
                              !allStepsHaveIntegration || testRun.running
                            }
                            loading={testRun.running}
                            loadingText="Running..."
                            data-testid="action-test-button"
                            className="gap-1.5"
                          >
                            <FlaskConical className="size-3.5" />
                            Test
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {allStepsHaveIntegration
                          ? 'Run the action with the test inputs'
                          : 'Select an integration for every step first'}
                      </TooltipContent>
                    </Tooltip>
                    <EditorActionsMenu
                      items={actionMenuItems}
                      testId="action-actions-button"
                    />
                  </>
                )
              }
            />
          }
        >
          <VersionHistory
            show={showVersions}
            onClose={() => setShowVersions(false)}
            loading={versionsLoading}
            versions={versions}
            currentVersion={action?.currentVersion}
            viewingVersion={viewingVersion?.version}
            onView={handleViewVersion}
          />

          <ConfirmationDialog
            open={pendingDuplicate !== null}
            title="Replace in-progress draft?"
            contentText="You already have an unsaved draft for a new action. Replace it with this duplicate?"
            confirmButtonText="Replace draft"
            onConfirm={handleConfirmDuplicate}
            onCancel={handleCancelDuplicate}
          />

          <ConfirmationDialog
            open={deleteDialogOpen}
            title="Delete action"
            contentText={
              <>
                {`This permanently deletes "${
                  draft.name || 'this action'
                }" and cannot be undone.${
                  draft.enabled
                    ? ' It is currently exposed to MCP / agents.'
                    : ''
                }`}
                <ReferenceUsageWarning
                  referenced={referencedDeleteTargets}
                  loading={usageLoading}
                />
              </>
            }
            confirmButtonText="Delete"
            confirmingText="Deleting…"
            isDelete
            onConfirm={() => {
              setDeleteDialogOpen(false);
              void handleDelete();
            }}
            onCancel={() => setDeleteDialogOpen(false)}
          />

          {renameGuard.dialog}
        </PipelineEditorLayout>
      </Form>
    </TooltipProvider>
  );
}
