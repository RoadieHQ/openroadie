import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SLUG_RE, rewriteReferences } from './references';
import { useReferenceRename } from '../use-reference-rename';
import {
  UnreferenceableSlugIcon,
  slugTriggerTooltip,
} from '../unreferenceable-slug';
import {
  RotateCcw,
  Undo2,
  History,
  X,
  ChevronRight,
  AtSign,
  Hash,
} from 'lucide-react';
import { slugify } from '@roadiehq/actions-common';
import { Button } from '@roadiehq/ui/button';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { Input } from '@roadiehq/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { EntityEditorHeader, EntityEditorShell } from '../../common';
import { Badge } from '@roadiehq/ui/badge';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@roadiehq/ui/form';
import { Editor } from '@roadiehq/ui/editor';
import { cn } from '@roadiehq/ui/utils';
import { markdown } from '@codemirror/lang-markdown';
import ReactMarkdown from 'react-markdown';
import {
  useCapabilities as useCapabilitiesApi,
  useAlert,
  type CapabilityInput,
  type CapabilityVersion,
} from '../../../api';
import {
  capabilityDetailQuery,
  capabilityVersionsQuery,
  invalidationKeys,
} from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { PATHS } from '../../../config/paths';
import { useCapabilityReferences } from './use-capability-references';
import { referenceAutocompletion } from './reference-completion';
import { remarkCapabilityReferences } from './remark-capability-references';
import { makeCapabilityReferenceComponents } from './capability-reference-pill';
import {
  useZodForm,
  useEditorDraft,
  workspaceEditorDraftKey,
} from '../../common';

interface DraftFields {
  name: string;
  slug: string;
  description: string;
  instructions: string;
}

const capabilityFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    // The same grammar the backend enforces and the token regex can match, so
    // a slug that saves here is always `@capability:`-referenceable.
    .regex(SLUG_RE, 'Use lowercase letters, numbers and hyphens'),
  description: z.string().trim().min(1, 'Description is required'),
  // Validate non-empty after trimming, but persist the markdown verbatim —
  // trimming would silently strip intentional leading/trailing whitespace and
  // trailing newlines from the instructions body.
  instructions: z
    .string()
    .refine(v => v.trim().length > 0, { message: 'Instructions are required' }),
});

/** Placeholder shown in the editable header title before the capability is named. */
const UNTITLED_CAPABILITY_LABEL = 'Untitled capability';

/** Persisted so navigating away from the editor and back doesn't discard
 *  in-progress edits. Scoped per capability id / "new" and kept in
 *  sessionStorage so it clears when the tab closes. */
function draftStorageKey(capabilityId: string | undefined): string {
  return workspaceEditorDraftKey('capabilities', capabilityId);
}

function parseDraft(raw: unknown): DraftFields | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const parsed = raw as Partial<DraftFields>;
  if (
    typeof parsed.name !== 'string' ||
    typeof parsed.description !== 'string' ||
    typeof parsed.instructions !== 'string'
  ) {
    return null;
  }
  return {
    name: parsed.name,
    // Fall back to a slug derived from the name when the draft has none.
    slug: typeof parsed.slug === 'string' ? parsed.slug : slugify(parsed.name),
    description: parsed.description,
    instructions: parsed.instructions,
  };
}

function isMeaningfulDraft(draft: DraftFields): boolean {
  if (draft.name.trim()) return true;
  if (draft.slug.trim()) return true;
  if (draft.description.trim()) return true;
  if (draft.instructions.trim()) return true;
  return false;
}

function draftFromCapability(source: {
  name: string;
  slug: string;
  description: string;
  instructions: string;
}): DraftFields {
  return {
    name: source.name,
    slug: source.slug,
    description: source.description,
    instructions: source.instructions,
  };
}

export function CapabilityEditor() {
  const { capabilityId } = useParams<{ capabilityId: string }>();
  // Remount the form when switching capabilities (or between a capability and
  // "new") so draft/dirty/version state resets cleanly instead of leaking
  // across routes — /capabilities/:id and /capabilities/new share this one
  // route element.
  return <CapabilityEditorForm key={capabilityId ?? 'new'} />;
}

function CapabilityEditorForm() {
  const { capabilityId } = useParams<{ capabilityId: string }>();
  const navigate = useNavigate();
  const capabilitiesApi = useCapabilitiesApi();
  const alertApi = useAlert();
  const { references, byKey } = useCapabilityReferences();
  // The slug rides the whole-form save, so this must be loaded whenever the
  // form can be submitted — not only while the slug popover is open.
  const renameGuard = useReferenceRename();

  // Keep the latest references in a ref so the editor extension — built once —
  // always reads the current list when the `@` menu opens.
  const referencesRef = useRef(references);
  useEffect(() => {
    referencesRef.current = references;
  }, [references]);

  const editorExtensions = useMemo(
    () => [markdown(), referenceAutocompletion(() => referencesRef.current)],
    [],
  );

  const previewComponents = useMemo(
    () => makeCapabilityReferenceComponents(byKey),
    [byKey],
  );

  // Show a real reference from this instance in the `@` hint so the example is
  // never a slug the author doesn't actually have. Falls back to a generic
  // placeholder before references have loaded (or when none exist).
  const hintExample = useMemo(() => {
    const first = references[0];
    return first ? `@${first.type}:${first.slug}` : '@datasource:your-source';
  }, [references]);

  const isNewCapability = capabilityId === 'new';
  const storageKey = draftStorageKey(capabilityId);
  const draft = useEditorDraft<DraftFields>(storageKey, parseDraft);

  const enabled = !isNewCapability && !!capabilityId;
  const capabilityQuery = useQuery({
    ...capabilityDetailQuery(capabilitiesApi, capabilityId ?? ''),
    enabled,
  });
  // `capabilityDetailQuery` resolves to null on a 404 (React Query forbids
  // undefined data); collapse both to undefined for the "not found" / seed
  // logic below.
  const capability = capabilityQuery.data ?? undefined;
  const loading = capabilityQuery.isLoading;
  const error = capabilityQuery.error;

  const versionsQuery = useQuery({
    ...capabilityVersionsQuery(capabilitiesApi, capabilityId ?? ''),
    enabled,
  });
  const versionsData = versionsQuery.data;
  const versionsLoading = versionsQuery.isLoading;

  const restoreMutation = useInvalidatingMutation({
    mutationFn: (version: number) => {
      if (!capabilityId || isNewCapability) {
        throw new Error('Cannot restore a version of a new capability');
      }
      return capabilitiesApi.restoreVersion(capabilityId, version);
    },
    invalidates: capabilityId
      ? invalidationKeys.capabilityVersioned(capabilityId)
      : [],
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: (input: CapabilityInput) => capabilitiesApi.create(input),
    invalidates: invalidationKeys.capabilitySaved(),
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: (input: CapabilityInput) => {
      if (!capabilityId || isNewCapability) {
        throw new Error('Cannot update a new capability');
      }
      return capabilitiesApi.update(capabilityId, input);
    },
    invalidates: invalidationKeys.capabilitySaved(capabilityId),
  });

  // For a new capability, seed from a persisted draft up front so there's no
  // blank flash. Existing capabilities seed once loaded (below).
  const newDraftSeed = isNewCapability ? draft.read() : null;
  const form = useZodForm({
    schema: capabilityFormSchema,
    defaultValues: {
      name: newDraftSeed?.name ?? '',
      slug: newDraftSeed?.slug ?? '',
      description: newDraftSeed?.description ?? '',
      instructions: newDraftSeed?.instructions ?? '',
    },
  });
  const name = form.watch('name');
  const slug = form.watch('slug');
  const description = form.watch('description');
  const instructions = form.watch('instructions');
  // While creating, the slug auto-tracks the name until the user edits it. Seed
  // from the restored draft so a hand-edited slug isn't clobbered on reload.
  const [slugEdited, setSlugEdited] = useState(
    () =>
      !!newDraftSeed?.slug && newDraftSeed.slug !== slugify(newDraftSeed.name),
  );
  const { isSubmitting, isDirty, isSubmitted } = form.formState;
  const rootError = form.formState.errors.root?.message;
  const [viewingVersion, setViewingVersion] =
    useState<CapabilityVersion | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [slugPopoverOpen, setSlugPopoverOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // Bumped on discard and folded into the instructions Editor's resetKey so it
  // adopts the reverted value even over an in-progress edit (the documented way
  // to force an external value through — see the Editor `resetKey` contract).
  const [discardNonce, setDiscardNonce] = useState(0);

  // Only re-seed on a genuine change of the loaded `capability` object — never
  // on a `viewingVersion` toggle, which is handled explicitly by its own
  // handlers.
  const seedDraftFromCapability = useCallback(
    (loaded: NonNullable<typeof capability>) => {
      const stored = draft.read();
      if (stored && isMeaningfulDraft(stored)) {
        // Keep the server definition as the baseline (defaults) so the form is
        // dirty against it, then layer the unsaved draft on top.
        form.reset(draftFromCapability(loaded));
        form.reset(stored, { keepDefaultValues: true });
      } else {
        if (stored) draft.clear();
        form.reset(draftFromCapability(loaded));
      }
    },
    [draft, form],
  );

  const seededCapabilityRef = useRef<typeof capability>(undefined);
  useEffect(() => {
    if (!capability || viewingVersion) return;
    if (seededCapabilityRef.current === capability) return;
    seededCapabilityRef.current = capability;
    seedDraftFromCapability(capability);
  }, [capability, viewingVersion, seedDraftFromCapability]);

  // Persist the working draft so it survives navigating away and back. Skip
  // while viewing a historical version or before an existing capability has
  // loaded/seeded; clear it once an existing capability reverts to its saved
  // value so a stale draft isn't restored on the next visit.
  useEffect(() => {
    const skip =
      !!viewingVersion || (!isNewCapability && !seededCapabilityRef.current);
    draft.persist(
      { name, slug, description, instructions },
      isNewCapability || isDirty,
      skip,
    );
  }, [
    name,
    slug,
    description,
    instructions,
    isDirty,
    isNewCapability,
    viewingVersion,
    capability,
    draft,
  ]);

  const handleSave = form.handleSubmit(async values => {
    form.clearErrors('root');
    const input = {
      name: values.name,
      slug: values.slug,
      description: values.description,
      instructions: values.instructions,
    };
    try {
      if (isNewCapability) {
        await createMutation.mutateAsync(input);
        draft.clear();
        alertApi.post({ message: 'Capability created', severity: 'success' });
        // Return to the list so the newly created capability is visible in
        // context, rather than dropping the author into an empty edit screen.
        navigate(PATHS.CAPABILITIES);
      } else if (capabilityId) {
        const commit = async (opts: { rewriteReferences: boolean }) => {
          // A capability can carry `@capability:<its-own-slug>`. That token has
          // to be rewritten in this same PUT: a follow-up write would be
          // clobbered by the stale instructions still held in form state.
          const instructions =
            opts.rewriteReferences && capability?.slug
              ? rewriteReferences(
                  values.instructions,
                  'capability',
                  capability.slug,
                  values.slug,
                )
              : values.instructions;
          const payload = { ...input, instructions };
          await updateMutation.mutateAsync(payload);
          draft.clear();
          form.reset(payload);
          alertApi.post({ message: 'Capability saved', severity: 'success' });
        };

        if (
          renameGuard.interceptRename({
            type: 'capability',
            fromSlug: capability?.slug,
            toSlug: values.slug,
            commit,
            excludeCapabilityId: capabilityId,
          })
        ) {
          return;
        }
        await commit({ rewriteReferences: false });
      }
    } catch (e: unknown) {
      form.setError('root', {
        message: e instanceof Error ? e.message : 'Failed to save',
      });
    }
  });

  // Revert every field to the last-saved capability and drop the persisted
  // draft so navigating away and back doesn't restore the discarded edits.
  // Bump the nonce so the CodeMirror instructions field adopts the reverted
  // value over any in-progress edit. Only reachable for an existing capability
  // — the button isn't rendered while creating.
  const handleDiscardConfirm = () => {
    if (capability) {
      form.reset(draftFromCapability(capability));
    }
    draft.clear();
    setDiscardNonce(n => n + 1);
    setShowDiscardConfirm(false);
  };

  const handleViewVersion = (version: CapabilityVersion) => {
    setViewingVersion(version);
    form.reset({
      name: version.name,
      slug: version.slug,
      description: version.description,
      instructions: version.instructions,
    });
  };

  const handleExitVersionView = () => {
    setViewingVersion(null);
    if (capability) {
      seedDraftFromCapability(capability);
    }
  };

  const handleRestoreVersion = async (version: number) => {
    if (!capabilityId || isNewCapability) return;
    try {
      await restoreMutation.mutateAsync(version);
      // Drop any stale unsaved draft so the seed effect doesn't restore it
      // over the just-restored version once the invalidated query refetches.
      draft.clear();
      setViewingVersion(null);
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

  if (error) {
    return (
      <EntityEditorShell>
        <EntityEditorHeader section="capabilities" title="Capability" />
        <div className="flex flex-1 items-center justify-center text-sm text-destructive">
          {error.message}
        </div>
      </EntityEditorShell>
    );
  }

  if (loading && !isNewCapability) {
    return (
      <EntityEditorShell>
        <EntityEditorHeader section="capabilities" title="Capability" />
        <div className="flex flex-1 items-center justify-center">
          <div className="motion-icon-spin size-6 rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </EntityEditorShell>
    );
  }

  if (!capability && !isNewCapability) {
    return (
      <EntityEditorShell>
        <EntityEditorHeader section="capabilities" title="Capability" />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Capability not found
        </div>
      </EntityEditorShell>
    );
  }

  // Name lives in the editable header title (data-source / action parity).
  // While viewing a historical version the form holds that version's values,
  // so the title shows the version's name read-only.
  const titleText = name.trim() ? name : UNTITLED_CAPABILITY_LABEL;

  // Committed on blur/Enter by the editable title. Guard the placeholder so
  // dismissing an untouched title on a new capability doesn't save the
  // placeholder as the name.
  const handleTitleChange = (value: string) => {
    const next =
      value === UNTITLED_CAPABILITY_LABEL && !name.trim() ? '' : value;
    form.setValue('name', next, { shouldDirty: true, shouldValidate: true });
    // On a new capability, keep the slug in sync with the name until the user
    // edits it manually.
    if (isNewCapability && !slugEdited) {
      form.setValue('slug', slugify(next), {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };

  const nameError = form.formState.errors.name?.message;
  const slugError = form.formState.errors.slug?.message;
  const descriptionError = form.formState.errors.description?.message;
  const instructionsError = form.formState.errors.instructions?.message;

  return (
    <TooltipProvider delayDuration={300}>
      <EntityEditorShell>
        {/* The Form context must wrap the header too — the slug/description
            popover in the title adornment renders FormFields. */}
        <Form {...form}>
          <EntityEditorHeader
            section="capabilities"
            title={titleText}
            editable={!viewingVersion}
            onTitleChange={handleTitleChange}
            description={description}
            editableDescription={!viewingVersion}
            onDescriptionChange={value =>
              form.setValue('description', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
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
                          data-testid="capability-slug-trigger"
                        >
                          <Hash className="size-3.5" />
                          {slug || 'slug'}
                          <UnreferenceableSlugIcon
                            type="capability"
                            slug={slug}
                          />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      {slugTriggerTooltip('capability', slug, 'Edit slug')}
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
                              placeholder="capability-slug"
                              {...field}
                              onChange={e => {
                                setSlugEdited(true);
                                field.onChange(e);
                              }}
                            />
                          </FormControl>
                          <FormDescription>
                            Reference this capability by its slug (e.g.{' '}
                            <code>@capability:{slug || 'my-capability'}</code>).
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </PopoverContent>
                </Popover>
              )
            }
            saveState={viewingVersion ? 'none' : 'manual'}
            onSave={handleSave}
            saving={isSubmitting}
            savingLabel="Saving..."
            isDirty={isDirty}
            saveLabel={isNewCapability ? 'Create' : 'Save'}
            saveDisabled={!isNewCapability && !isDirty}
            actions={
              <div className="flex items-center gap-2">
                {viewingVersion && (
                  <Badge variant="secondary">
                    Viewing v{viewingVersion.version}
                  </Badge>
                )}
                {viewingVersion &&
                  capability &&
                  viewingVersion.version !== capability.currentVersion && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleRestoreVersion(viewingVersion.version)
                      }
                      disabled={restoreMutation.isPending}
                    >
                      <RotateCcw className="size-4" />
                      {restoreMutation.isPending ? 'Restoring...' : 'Restore'}
                    </Button>
                  )}
                {viewingVersion && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExitVersionView}
                  >
                    <X className="size-4" />
                    Exit
                  </Button>
                )}
                {!isNewCapability && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowVersions(!showVersions)}
                  >
                    <History className="size-4" />
                    History
                  </Button>
                )}
                {!viewingVersion && !isNewCapability && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowDiscardConfirm(true)}
                    disabled={!isDirty || isSubmitting}
                    data-testid="capability-discard"
                  >
                    <Undo2 className="size-4" />
                    Discard
                  </Button>
                )}
              </div>
            }
          />
          <div className="flex flex-1 overflow-hidden">
            {/* Disable every field while a save is in flight. `display: contents`
              keeps the fieldset out of the flex layout. CodeMirror is a
              contenteditable, not a native control, so `fieldset[disabled]`
              can't reach it — it takes `readOnly` explicitly below. */}
            <fieldset disabled={isSubmitting} className="contents">
              <div className="flex min-w-0 flex-1 flex-col border-r border-border">
                {/* Name lives in the header title and slug/description in its
                  popover — none of which has a FormMessage slot — and
                  instructions is a CodeMirror editor (bound via FormField
                  below). Their validation errors and the save/root error are
                  surfaced here instead. Several can be set at once, so render
                  each rather than letting one mask the other. Field errors are
                  gated on a submit attempt so onChange validation doesn't
                  flash errors for fields hidden in the closed popover. */}
                {((isSubmitted &&
                  (nameError || slugError || descriptionError)) ||
                  instructionsError ||
                  rootError) && (
                  <div
                    role="alert"
                    className="space-y-1 border-b border-border px-4 py-3 text-xs text-destructive"
                  >
                    {isSubmitted && nameError && <p>{nameError}</p>}
                    {isSubmitted && slugError && <p>Slug: {slugError}</p>}
                    {isSubmitted && descriptionError && (
                      <p>{descriptionError}</p>
                    )}
                    {instructionsError && <p>{instructionsError}</p>}
                    {rootError && <p>{rootError}</p>}
                  </div>
                )}
                {/* h-12 fits the hint's two wrapped lines and matches the
                    Preview pane header so their bottom borders align. */}
                <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-muted/30 px-4 text-xs text-muted-foreground">
                  <AtSign className="size-3.5 shrink-0" />
                  <span className="line-clamp-2 min-w-0">
                    Type <code className="rounded bg-muted px-1 py-0.5">@</code>{' '}
                    to reference a data source, action, context group, or
                    capability (e.g.{' '}
                    <code className="rounded bg-muted px-1 py-0.5">
                      {hintExample}
                    </code>
                    ). The assistant resolves these when running the capability.
                  </span>
                </div>
                <FormField
                  control={form.control}
                  name="instructions"
                  render={({ field }) => (
                    <div className="flex-1 overflow-hidden">
                      <Editor
                        aria-label="Instructions"
                        value={field.value}
                        onChange={field.onChange}
                        resetKey={
                          viewingVersion
                            ? `view-${viewingVersion.version}`
                            : `edit-${capability?.currentVersion ?? 'new'}-${discardNonce}`
                        }
                        extensions={editorExtensions}
                        height="100%"
                        readOnly={!!viewingVersion || isSubmitting}
                        setup={{ autocompletion: false }}
                        className="h-full rounded-none border-0 shadow-none"
                        editorClassName="text-sm [&_.cm-cursor]:!border-l-foreground [&_.cm-editor]:h-full [&_.cm-gutters]:!border-none [&_.cm-gutters]:!bg-transparent [&_.cm-scroller]:!overflow-auto dark:[&_.cm-selectionBackground]:!bg-white/20"
                      />
                    </div>
                  )}
                />
              </div>

              <div className="flex w-1/2 min-w-0 flex-col bg-card">
                <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Preview
                  </h3>
                </div>
                <div className="flex-1 overflow-auto p-6">
                  <article className="markdown-preview max-w-none text-sm break-words [&_a:not([data-capability-reference])]:break-all [&_a:not([data-capability-reference])]:text-primary [&_a:not([data-capability-reference])]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_hr]:my-6 [&_hr]:border-border [&_li]:mb-1 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-4 [&_p]:leading-relaxed [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6">
                    <h1>{name || 'Untitled'}</h1>
                    <p className="whitespace-pre-line text-muted-foreground">
                      {description || 'No description'}
                    </p>
                    <ReactMarkdown
                      remarkPlugins={[remarkCapabilityReferences]}
                      components={previewComponents}
                    >
                      {instructions || '*No instructions yet*'}
                    </ReactMarkdown>
                  </article>
                </div>
              </div>
            </fieldset>
          </div>
        </Form>

        <div
          className={cn(
            'motion-panel fixed inset-y-0 right-0 z-40 flex w-80 flex-col border-l border-border bg-card shadow-lg',
            showVersions ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Version History</h3>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setShowVersions(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto">
            {versionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="motion-icon-spin size-5 rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : versions.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No version history
              </div>
            ) : (
              <div className="divide-y divide-border">
                {versions.map(version => (
                  <Button
                    key={version.id}
                    variant="ghost"
                    className={cn(
                      'flex h-auto w-full items-center gap-3 rounded-none px-4 py-3 text-left',
                      capability &&
                        version.version === capability.currentVersion &&
                        'bg-primary/5',
                      viewingVersion?.version === version.version &&
                        'ring-2 ring-primary ring-inset',
                    )}
                    onClick={() => handleViewVersion(version)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          v{version.version}
                        </span>
                        {capability &&
                          version.version === capability.currentVersion && (
                            <Badge variant="default" className="text-[10px]">
                              Current
                            </Badge>
                          )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {version.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(version.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
        {showVersions && (
          <div
            role="presentation"
            className="fixed inset-0 z-30 bg-black/20"
            onClick={() => setShowVersions(false)}
          />
        )}

        <ConfirmationDialog
          open={showDiscardConfirm}
          isDelete
          title="Discard unsaved changes?"
          contentText="This reverts the capability to its last saved version. This cannot be undone."
          confirmButtonText="Discard"
          onConfirm={handleDiscardConfirm}
          onCancel={() => setShowDiscardConfirm(false)}
        />
        {renameGuard.dialog}
      </EntityEditorShell>
    </TooltipProvider>
  );
}
