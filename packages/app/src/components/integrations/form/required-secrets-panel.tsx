import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import {
  Check,
  CircleMinus,
  Clock,
  ExternalLink,
  Trash2,
  X,
} from 'lucide-react';
import { useAlert, useSecrets } from '../../../api';
import { SecretStatusType } from '../../../api/secrets';
import {
  invalidationKeys,
  queryKeys,
  secretStorageModeQuery,
} from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import {
  type SecretRequirement,
  resolvedSecretsQuery,
} from '../resolve-secret-requirement';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { SECRET } from '../../overview';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { InlineCode } from '@roadiehq/ui/inline-code';
import { Input } from '@roadiehq/ui/input';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { FieldHint } from '@roadiehq/ui/field-hint';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';

// Stable empty reference so consumers memoizing on `requirements` don't churn
// while the resolution query is idle or unresolved.
const EMPTY_REQUIREMENTS: SecretRequirement[] = [];

const MASKED_SECRET_STANDIN = '•'.repeat(14);

const UNSET_VALUE_PLACEHOLDER = 'Click to set secret value';

const secretValueFieldShellClass =
  'min-h-10 w-full items-center rounded-sm border border-input-border/70 bg-muted/30 pl-3 dark:bg-muted/20';

function RequiredSecretsPanelLoading() {
  return (
    <div className="border-b border-divider pb-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Required secrets</h3>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-[98px] w-full rounded-md" />
        <Skeleton className="h-[98px] w-full rounded-md" />
      </div>
    </div>
  );
}

function SecretRowStatus({ requirement }: { requirement: SecretRequirement }) {
  if (requirement.secret?.status === SecretStatusType.Available) {
    return (
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center text-success"
        role="img"
        aria-label={SECRET.configured.label}
      >
        <Check className="size-4" strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span
      className="inline-flex size-6 shrink-0 items-center justify-center"
      role="img"
      aria-label={SECRET.notSet.label}
    >
      <CircleMinus className="size-4 text-warning" strokeWidth={2} />
    </span>
  );
}

function formatSecretLastModified(iso?: string) {
  if (!iso) {
    return null;
  }
  try {
    return DateTime.fromJSDate(new Date(iso)).toRelative({
      unit: ['days', 'hours', 'minutes', 'seconds'],
    });
  } catch {
    return null;
  }
}

const permissionHelpAllowPatterns = [
  /\baccess token\b/,
  /\bpersonal access token\b/,
  /\bapi token\b/,
  /\bapi key\b/,
  /\baccess key\b/,
  /\bapp key\b/,
  /\bapplication key\b/,
  /\bclient secret\b/,
  /\bprivate key\b/,
  /\bpassword\b/,
  /\bbearer\b/,
  /(^|[_\s-])token([_\s-]|$)/,
];

const permissionHelpDenyPatterns = [
  /\btenant id\b/,
  /\bclient id\b/,
  /\bapp id\b/,
  /\bapplication id\b/,
  /\bissuer\b/,
  /\baudience\b/,
  /\bsubject\b/,
  /\busername\b/,
  /\bwebhook\b/,
  /\bslug\b/,
  /\bworkspace id\b/,
  /\borganization id\b/,
  /\baccount id\b/,
];

function shouldShowPermissionsHelp(requirement: SecretRequirement): boolean {
  if (!requirement.secret?.helpUrl) {
    return false;
  }

  const secretText = [
    requirement.secret.name,
    requirement.secret.description,
    requirement.secret.helpUrl,
    requirement.ref,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (permissionHelpDenyPatterns.some(pattern => pattern.test(secretText))) {
    return false;
  }

  return permissionHelpAllowPatterns.some(pattern => pattern.test(secretText));
}

function RequiredSecretRow({
  requirement,
  lastUpdatedLabel,
  readOnly,
  onSaved,
}: {
  requirement: SecretRequirement;
  lastUpdatedLabel: string | null;
  readOnly: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const secretName = requirement.secret?.name ?? requirement.ref;
  const isAvailable = requirement.secret?.status === SecretStatusType.Available;
  const isCustom = Boolean(requirement.secret?.isCustom);
  const variant = isAvailable ? 'update' : 'set';
  const showPermissionsHelp = shouldShowPermissionsHelp(requirement);

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const valueFieldId = React.useId();
  const valueInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      valueInputRef.current?.focus();
    }
  }, [editing]);

  const secretsApi = useSecrets();
  const alertApi = useAlert();

  const upsertMutation = useInvalidatingMutation({
    mutationFn: () =>
      secretsApi.upsertSecret({
        name: secretName,
        internalKeyName: secretName,
        value,
      }),
    invalidates: invalidationKeys.secretCatalog(),
  });
  const saving = upsertMutation.isPending;

  const deleteMutation = useInvalidatingMutation({
    mutationFn: async () => {
      await secretsApi.deleteSecret(secretName);
      if (isCustom) {
        await secretsApi.deleteSecretMetadata(secretName);
      }
    },
    invalidates: invalidationKeys.secretCatalog(),
  });

  const showValueButton = !readOnly;
  const showDeleteButton = !readOnly && isAvailable;

  const handleSubmit = async () => {
    if (saving || !value.trim()) {
      return;
    }
    try {
      await upsertMutation.mutateAsync();
      alertApi.post({
        message: variant === 'update' ? 'Secret updated' : 'Secret saved',
        severity: 'success',
        display: 'transient',
      });
      await onSaved();
      setValue('');
      setEditing(false);
    } catch (error) {
      alertApi.post({
        message:
          error instanceof Error ? error.message : 'Failed to save secret',
        severity: 'error',
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync();
      alertApi.post({
        message: 'Secret removed',
        severity: 'success',
        display: 'transient',
      });
      await onSaved();
      setDeleteOpen(false);
    } catch (error: unknown) {
      alertApi.post({
        message:
          error instanceof Error ? error.message : 'Failed to remove secret',
        severity: 'error',
      });
      throw error;
    }
  };

  const startEditing = () => {
    setValue('');
    setEditing(true);
  };

  const cancelEditing = () => {
    setValue('');
    setEditing(false);
  };

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border p-3',
        isAvailable
          ? 'border-success/15 bg-success/5 dark:border-success/20 dark:bg-success/10'
          : 'border-warning/15 bg-warning/5 dark:border-warning/20 dark:bg-warning/10',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="shrink-0">
          <SecretRowStatus requirement={requirement} />
        </div>
        <div className="min-w-0 flex-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-0 w-auto max-w-full min-w-0 cursor-default rounded-sm border-0 border-b border-dotted border-muted-foreground/40 p-0 text-left text-sm font-medium text-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                {secretName}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <span className="text-xs text-muted-foreground">
                Environment variable key
              </span>
              <div className="mt-1">
                <InlineCode className="text-xs">{requirement.ref}</InlineCode>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
        {isAvailable && lastUpdatedLabel ? (
          <div className="ml-auto shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={`Last updated ${lastUpdatedLabel}`}
                >
                  <Clock className="size-4" strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" align="center">
                Last updated {lastUpdatedLabel}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>

      {(requirement.secret?.description || requirement.secret?.helpUrl) && (
        <p className="text-xs text-muted-foreground">
          {requirement.secret?.description}
          {requirement.secret?.description && requirement.secret?.helpUrl
            ? ' '
            : null}
          {requirement.secret?.helpUrl && (
            <a
              href={requirement.secret.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              Docs
              <ExternalLink className="size-3 shrink-0" />
            </a>
          )}
          {showPermissionsHelp && (
            <>
              {' '}
              <span className="inline-flex align-middle">
                <FieldHint
                  ariaLabel={`${secretName} permissions help`}
                  onField
                  contentClassName="max-w-[320px]"
                >
                  <p>
                    Choose access based on the data you want to access or
                    actions you want to use. Broader read access gives richer
                    context and relationships for more use cases; add write or
                    admin permissions only when you need them.
                  </p>
                </FieldHint>
              </span>
            </>
          )}
        </p>
      )}

      {isAvailable && !editing && showValueButton && (
        <div
          className={`flex w-full min-w-0 items-center ${secretValueFieldShellClass} pr-1`}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={startEditing}
            className="h-auto min-h-10 w-full max-w-full min-w-0 flex-1 cursor-text justify-start border-0 bg-transparent px-0 pr-1 text-left text-base font-normal shadow-none ring-offset-background hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-muted/20"
          >
            <span className="sr-only">
              A secret value is stored, not shown. Click or press Enter to
              change it.
            </span>
            <span
              aria-hidden
              className="font-mono text-sm leading-none tracking-[0.35em] text-muted-foreground select-none"
            >
              {MASKED_SECRET_STANDIN}
            </span>
          </Button>
          {showDeleteButton && (
            <div className="flex shrink-0 items-center pr-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${secretName}`}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {isAvailable && !editing && !showValueButton && (
        <div
          className={`flex w-full min-w-0 items-center ${secretValueFieldShellClass} pr-1`}
        >
          <div className="min-h-10 min-w-0 flex-1 pr-1">
            <span className="sr-only">
              A secret value is stored. The value is not shown.
            </span>
            <span
              aria-hidden
              className="font-mono text-sm leading-none tracking-[0.35em] text-muted-foreground select-none"
            >
              {MASKED_SECRET_STANDIN}
            </span>
          </div>
          {showDeleteButton && (
            <div className="flex shrink-0 items-center pr-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${secretName}`}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {!isAvailable && showValueButton && !editing && (
        <div className={`flex ${secretValueFieldShellClass} pr-3`}>
          <label htmlFor={valueFieldId} className="sr-only">
            Secret value
          </label>
          <Input
            id={valueFieldId}
            type="password"
            name="secretValue"
            value=""
            readOnly
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            placeholder={UNSET_VALUE_PLACEHOLDER}
            onFocus={startEditing}
            aria-label="Secret not set, focus to enter a value"
            className="h-9 min-w-0 flex-1 cursor-text border-0 bg-transparent px-0 py-0 text-sm text-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
          />
        </div>
      )}

      {editing && showValueButton && (
        // Not a <form>: this editor renders inside the integration shell's
        // form element and forms cannot nest. Enter is wired manually.
        <div className={`flex ${secretValueFieldShellClass} pr-1`}>
          <label htmlFor={valueFieldId} className="sr-only">
            Secret value
          </label>
          <Input
            id={valueFieldId}
            ref={valueInputRef}
            type="password"
            name="secretValue"
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            required
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm text-foreground shadow-none focus-visible:ring-0"
          />
          <div className="flex shrink-0 items-center gap-0.5 pr-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={cancelEditing}
              disabled={saving}
              aria-label="Cancel editing"
            >
              <X className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              disabled={saving || !value.trim()}
              aria-label="Save secret"
              onClick={() => void handleSubmit()}
            >
              {saving ? (
                <Spinner size={16} className="text-current" />
              ) : (
                <Check className="size-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        title="Remove secret?"
        contentText={
          <>
            This clears the stored value for{' '}
            <code className="text-sm">{secretName}</code>. The integration may
            not work until you set this secret again.
          </>
        }
        confirmButtonText="Remove"
        isDelete
        onConfirm={handleDelete}
      />
    </div>
  );
}

export function RequiredSecretsPanel({
  secretRefs,
  onSecretsChanged,
}: {
  secretRefs: string[];
  onSecretsChanged?: () => void;
}) {
  const secretsApi = useSecrets();
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const storageModeQuery = useQuery(secretStorageModeQuery(secretsApi));
  const storageMode = storageModeQuery.data;
  const storageModeLoading = storageModeQuery.isLoading;
  const hiddenSecretRefs = useMemo(
    () =>
      storageModeLoading
        ? undefined
        : storageMode?.mode === 'scoped'
          ? new Set(storageMode.hiddenSecretRefs ?? [])
          : new Set<string>(),
    [storageMode, storageModeLoading],
  );
  const uniqueSecretRefs = useMemo(
    () =>
      !hiddenSecretRefs
        ? []
        : Array.from(
            new Set(secretRefs.filter(ref => !hiddenSecretRefs.has(ref))),
          ).sort((a, b) => a.localeCompare(b)),
    [secretRefs, hiddenSecretRefs],
  );
  const requirementsQuery = useQuery({
    ...resolvedSecretsQuery(secretsApi, uniqueSecretRefs),
    enabled: uniqueSecretRefs.length > 0,
  });
  const requirements = requirementsQuery.data ?? EMPTY_REQUIREMENTS;
  const loading = uniqueSecretRefs.length > 0 && requirementsQuery.isLoading;

  const requirementsMatchRefs =
    requirements.length === uniqueSecretRefs.length &&
    uniqueSecretRefs.every(ref => requirements.some(r => r.ref === ref));
  const isChecking = loading || !requirementsMatchRefs;
  const missingCount = requirements.filter(
    requirement => requirement.missing,
  ).length;

  const orderedRequirements = useMemo(
    () =>
      [...requirements].sort((a, b) => {
        if (a.missing !== b.missing) {
          return a.missing ? -1 : 1;
        }
        return a.ref.localeCompare(b.ref);
      }),
    [requirements],
  );

  if (storageModeLoading) {
    return <RequiredSecretsPanelLoading />;
  }

  if (uniqueSecretRefs.length === 0) {
    return null;
  }

  const handleSecretSaved = async () => {
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.resolvedSecretsPrefix,
        workspaceScopeKey,
      ),
    });
    onSecretsChanged?.();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="border-b border-divider pb-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Required secrets</h3>
          {isChecking ? (
            <Badge variant="outline">Checking...</Badge>
          ) : missingCount > 0 ? (
            <Badge variant="warningSubtle">{missingCount} missing</Badge>
          ) : (
            <Badge variant="success">{SECRET.configured.label}</Badge>
          )}
        </div>

        {!isChecking && (
          <p className="mt-1 text-xs text-muted-foreground">
            {missingCount > 0
              ? 'Populate the missing secrets to finish configuring this integration.'
              : 'All required secrets are configured.'}
          </p>
        )}

        {storageMode?.readOnly && missingCount > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Secrets are managed externally in this environment.
          </p>
        )}

        {isChecking ? (
          <div className="mt-4 space-y-3">
            {uniqueSecretRefs.map(ref => (
              <Skeleton key={ref} className="h-[98px] w-full rounded-md" />
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {orderedRequirements.map(requirement => {
              const lastUpdatedLabel = formatSecretLastModified(
                requirement.secret?.lastModified,
              );
              return (
                <RequiredSecretRow
                  key={requirement.ref}
                  requirement={requirement}
                  lastUpdatedLabel={lastUpdatedLabel}
                  readOnly={storageMode?.readOnly ?? false}
                  onSaved={handleSecretSaved}
                />
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
