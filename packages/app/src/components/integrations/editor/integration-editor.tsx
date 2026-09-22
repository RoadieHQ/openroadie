import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Copy, Trash2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import { Form } from '@roadiehq/ui/form';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import {
  EntityEditorHeader,
  EntityEditorShell,
  EntityEditorFormBody,
  UnsavedChangesBlocker,
  resolveFormWatchedTitle,
  resolveIntegrationPageTitle,
} from '../../common';
import { useWorkflows, useAlert } from '../../../api';
import { invalidationKeys } from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { PATHS } from '../../../config/paths';
import { AutoEnableDataSourcesToggle } from '../auto-enable-data-sources-toggle';
import { useIntegrations } from '../use-integrations';
import { useGithubAppInstallReturn } from '../use-github-app-install-return';
import type { Integration, IntegrationItem } from '../types';
import { isGitHubAppIntegration } from '../types';
import {
  useHasMatchingDataSourceSeeds,
  useSeedActivation,
} from '../use-seed-activation';
import { getIntegrationRequiredSecretRefs } from '../secret-requirements';
import { getIntegrationUsageReason } from '../delete-disabled-reason';
import {
  GitHubIntegrationDialog,
  IntegrationFormFields,
  useIntegrationForm,
} from '../form';
import { useIntegrationFormShell } from '../form/integration-form-shell';

/**
 * Routed, deep-linkable integration editor mounted at `/integrations/new` and
 * `/integrations/:integrationId`. Regular integrations render as a full page
 * (parity with the Capabilities / Actions / Context Groups editors); GitHub App
 * integrations render their existing dialog on this route (both are shareable —
 * a follow-up can convert the GitHub form to a full page without touching
 * routing). The admin embed of the overview keeps using the dialogs directly.
 */
export function IntegrationEditor() {
  const { integrationId } = useParams<{ integrationId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const api = useWorkflows();
  const alertApi = useAlert();
  const allowPostMutationNavigationRef = useRef(false);

  const { integrations, loading, refetch } = useIntegrations({
    includeRelationshipRules: true,
  });

  // Complete the GitHub App install redirect if it landed on this route.
  useGithubAppInstallReturn(refetch);

  const isNew = !integrationId || integrationId === 'new';
  const duplicateFromId = searchParams.get('from');

  const target = useMemo(
    () => (isNew ? undefined : integrations.find(i => i.id === integrationId)),
    [isNew, integrations, integrationId],
  );
  const template = useMemo(
    () =>
      isNew && duplicateFromId
        ? integrations.find(i => i.id === duplicateFromId)
        : undefined,
    [isNew, duplicateFromId, integrations],
  );

  const goBack = useCallback(() => navigate(PATHS.INTEGRATIONS), [navigate]);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Mirrors the overview's delete: invalidate the integrations list (what
  // `useIntegrations` reads) and the data-ingestion workflows so a source built
  // on the deleted integration reflects the change.
  const deleteMutation = useInvalidatingMutation({
    mutationFn: (id: string) => api.integrations.delete(id),
    invalidates: invalidationKeys.integrationDeleted(),
  });

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      alertApi.post({
        message: 'Integration deleted',
        severity: 'success',
        display: 'transient',
      });
      setDeleteTarget(null);
      allowPostMutationNavigationRef.current = true;
      goBack();
    } catch (error) {
      alertApi.post({
        message: `Failed to delete: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        severity: 'error',
      });
      setDeleteTarget(null);
    }
  }, [deleteMutation, alertApi, deleteTarget, goBack]);

  // Editing an id that isn't loaded yet → spinner; genuinely missing → message.
  if (!isNew && !target) {
    if (loading) {
      return (
        <EntityEditorShell>
          <EntityEditorHeader section="integrations" title="Integration" />
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-5" />
          </div>
        </EntityEditorShell>
      );
    }
    return (
      <EntityEditorShell>
        <EntityEditorHeader
          section="integrations"
          title="Integration not found"
        />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          This integration doesn&apos;t exist or was deleted.
        </div>
      </EntityEditorShell>
    );
  }

  const deleteConfirm = (
    <ConfirmationDialog
      open={!!deleteTarget}
      title="Delete integration"
      contentText={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
      onConfirm={handleDeleteConfirm}
      onCancel={() => setDeleteTarget(null)}
      isDelete
      confirmButtonText="Delete"
    />
  );

  // GitHub App integrations render their editor as a full page too (parity with
  // the generic editor); the component provides its own page chrome in this mode.
  // Duplicate (enterprise app) routes to a seeded new form.
  if (target && isGitHubAppIntegration(target)) {
    return (
      <>
        <GitHubIntegrationDialog
          variant="page"
          open
          onClose={goBack}
          integration={target}
          onInstallationsChanged={refetch}
          onSecretsChanged={refetch}
          onRequestDelete={() =>
            setDeleteTarget({ id: target.id, name: target.name })
          }
          deleteDisabledReason={getIntegrationUsageReason(target)}
          onRequestDuplicate={
            target.slug === 'github-enterprise-app'
              ? () => navigate(`${PATHS.INTEGRATIONS_NEW}?from=${target.id}`)
              : undefined
          }
        />
        {deleteConfirm}
      </>
    );
  }

  return (
    <>
      <IntegrationEditorForm
        integration={target}
        template={template}
        onClose={goBack}
        onSaved={refetch}
        allowNavigationRef={allowPostMutationNavigationRef}
        onRequestDelete={
          target
            ? () => setDeleteTarget({ id: target.id, name: target.name })
            : undefined
        }
        onRequestDuplicate={
          target
            ? () => navigate(`${PATHS.INTEGRATIONS_NEW}?from=${target.id}`)
            : undefined
        }
        deleteDisabledReason={target ? getIntegrationUsageReason(target) : null}
      />
      {deleteConfirm}
    </>
  );
}

interface IntegrationEditorFormProps {
  integration?: IntegrationItem;
  template?: IntegrationItem;
  onClose: () => void;
  onSaved: () => void;
  allowNavigationRef: { current: boolean };
  onRequestDelete?: () => void;
  onRequestDuplicate?: () => void;
  deleteDisabledReason: string | null;
}

/**
 * Full-page form for creating / editing a non-GitHub integration. Reuses the
 * dialog's `useIntegrationForm` controller and the shared `IntegrationFormFields`
 * body inside a page shell (`EditorHeader` + scroll region), so the fields
 * stay identical to the dialog.
 */
function IntegrationEditorForm({
  integration,
  template,
  onClose,
  onSaved,
  allowNavigationRef,
  onRequestDelete,
  onRequestDuplicate,
  deleteDisabledReason,
}: IntegrationEditorFormProps) {
  const nameFieldInputRef = useRef<HTMLInputElement | null>(null);

  const isSystemIntegration = integration?.createdBy === 'system';
  // Only offered when editing an existing pre-built integration (not new,
  // not a duplicate-from-template flow) that has matching seed templates.
  const isEditingSystemIntegration =
    Boolean(integration) && isSystemIntegration;
  const { hasMatchingSeeds, matchingSeedNames } = useHasMatchingDataSourceSeeds(
    isEditingSystemIntegration ? integration?.slug : undefined,
  );
  const showAutoEnableToggle = isEditingSystemIntegration && hasMatchingSeeds;
  const [autoEnableSeeds, setAutoEnableSeeds] = useState(true);
  const { activate } = useSeedActivation();

  const handleSaved = useCallback(
    (savedIntegration: Integration) => {
      allowNavigationRef.current = true;
      onSaved();
      if (showAutoEnableToggle && autoEnableSeeds) {
        void activate(savedIntegration.id);
      }
    },
    [
      allowNavigationRef,
      onSaved,
      showAutoEnableToggle,
      autoEnableSeeds,
      activate,
    ],
  );

  const {
    form,
    isEdit,
    autoSlug,
    markSlugEdited,
    secretOptions,
    reservedSecretNames,
    handleSave,
    refreshSecretList,
    secretsListReadOnly,
    logoCatalog,
  } = useIntegrationForm({
    open: true,
    onClose,
    onSaved: handleSaved,
    integration,
    template,
  });

  const sourceIntegration = integration ?? template;
  const requiredSecretRefs = sourceIntegration
    ? getIntegrationRequiredSecretRefs(sourceIntegration)
    : [];

  // The page is always editable (system integrations lock metadata but not the
  // whole form). The prebuilt read-only view is a dialog-only concern.
  const metadataReadOnly = isSystemIntegration;
  const advancedReadOnly = isSystemIntegration;

  const {
    scrollContainerRef,
    advancedOpen,
    setAdvancedOpenPreservingScroll,
    handleInvalidSave,
  } = useIntegrationFormShell({
    form,
    isEdit,
    readOnly: false,
    isSystemIntegration,
    handleSave,
    onClose,
  });

  // Title tracks the entity name for parity with the other entity editors.
  const entityName = (integration ?? template)?.name;
  const pageTitle = resolveIntegrationPageTitle({
    isEdit,
    isDuplicate: Boolean(template),
    entityName,
  });
  const displayTitle = resolveFormWatchedTitle(form.watch('name'), pageTitle);
  const logoUrl = (integration ?? template)?.logoUrl;

  // Reading via the formState proxy subscribes this component to isDirty.
  const { isDirty, isSubmitting } = form.formState;
  // Save failures land on the root error (set by useIntegrationForm); the page
  // must surface it, otherwise a failed save is silent. Mirrors the dialog shell.
  const rootError = form.formState.errors.root?.message;

  return (
    // Fields render on the page background here (not a card), so tell the
    // outlined-field labels to mask their border with the background color —
    // otherwise the floating labels show a card-colored rectangle in dark mode.
    <EntityEditorShell
      style={{ '--field-bg': 'var(--color-background)' } as CSSProperties}
    >
      <UnsavedChangesBlocker
        when={isDirty}
        allowNavigationRef={allowNavigationRef}
        contentText="Your edits to this integration have not been saved and will be lost."
      />
      <EntityEditorHeader
        section="integrations"
        title={displayTitle}
        logoUrl={logoUrl}
        saveState="manual"
        isDirty={form.formState.isDirty}
        saving={form.formState.isSubmitting}
        onSave={() => handleSave(handleInvalidSave)}
        saveDisabled={isEdit && !form.formState.isDirty}
        saveLabel={isEdit ? 'Save' : 'Create'}
        actions={
          isEdit && (onRequestDuplicate || onRequestDelete) ? (
            <TooltipProvider delayDuration={300}>
              <div className="flex items-center gap-2">
                {onRequestDuplicate && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onRequestDuplicate}
                      >
                        <Copy className="size-4" />
                        Duplicate
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Duplicate integration
                    </TooltipContent>
                  </Tooltip>
                )}
                {onRequestDelete && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={!!deleteDisabledReason}
                          onClick={onRequestDelete}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {deleteDisabledReason ?? 'Delete integration'}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </TooltipProvider>
          ) : undefined
        }
      />
      <Form {...form}>
        <EntityEditorFormBody ref={scrollContainerRef}>
          {showAutoEnableToggle && (
            <AutoEnableDataSourcesToggle
              checked={autoEnableSeeds}
              onCheckedChange={setAutoEnableSeeds}
              seedNames={matchingSeedNames}
            />
          )}
          <fieldset disabled={isSubmitting} className="contents">
            <IntegrationFormFields
              form={form}
              isEdit={isEdit}
              autoSlug={autoSlug}
              onSlugEdited={markSlugEdited}
              secretOptions={secretOptions}
              reservedSecretNames={reservedSecretNames}
              refreshSecretList={refreshSecretList}
              secretsListReadOnly={secretsListReadOnly}
              logoCatalog={logoCatalog}
              onSecretsChanged={onSaved}
              readOnly={false}
              isPreBuiltReadOnly={false}
              metadataReadOnly={metadataReadOnly}
              advancedReadOnly={advancedReadOnly}
              nameReadOnly={false}
              requiredSecretRefs={requiredSecretRefs}
              logoPickerPopoverContainer={null}
              nameFieldInputRef={nameFieldInputRef}
              advancedOpen={advancedOpen}
              onAdvancedOpenChange={setAdvancedOpenPreservingScroll}
              integrationId={integration?.id}
            />
          </fieldset>
          {rootError && (
            <p
              role="alert"
              className="mt-4 text-sm font-medium text-destructive"
            >
              {rootError}
            </p>
          )}
        </EntityEditorFormBody>
      </Form>
    </EntityEditorShell>
  );
}
