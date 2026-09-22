import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@roadiehq/ui/dialog';
import { FormSection } from '@roadiehq/ui/form-section';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import {
  EntityEditorHeader,
  EntityEditorShell,
  EntityEditorFormBody,
} from '../../common';
import {
  CheckCircle2,
  Trash2,
  Copy,
  ExternalLink,
  Building2,
  CircleAlert,
  GitFork,
  Bot,
  Blocks,
  CircleHelp,
  Clock,
  Pencil,
  Plus,
} from 'lucide-react';
import { useWorkflows, useAlert, useAppConfig, useSecrets } from '../../../api';
import {
  githubAppInstallationsQuery,
  githubAppInstallRequestsQuery,
  githubAppsQuery,
  secretKeysQuery,
  secretMetadataQuery,
  secretStorageModeQuery,
  queryKeys,
} from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import type {
  GithubAppConnectionTestResult,
  GithubAppInstallation,
  GithubAppInstallationsWarning,
  GithubAppInstallRequest,
  GithubAppRecord,
} from '../../../api/workflow/workflow-client';
import { ResponseError } from '../../../api/infrastructure';
import type { IntegrationItem, GithubAppInfo } from '../types';
import { getIntegrationRequiredSecretRefs } from '../secret-requirements';
import { useZodForm } from '../../common';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { RequiredSecretsPanel } from './required-secrets-panel';
import { IntegrationSecretOutlinedSelect } from './integration-secret-outlined-select';
import { extractSecretName, toSecretVariable } from './integration-secret-refs';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';
import { buildGithubAppTemplateRegistrationUrl } from './github-app-template-link';
import { INTEGRATION_HTTP_BASE_URL_PLACEHOLDER } from '../constants';
import { AutoEnableDataSourcesToggle } from '../auto-enable-data-sources-toggle';
import {
  useHasMatchingDataSourceSeeds,
  useSeedActivation,
} from '../use-seed-activation';

interface GitHubIntegrationDialogProps {
  open: boolean;
  onClose: () => void;
  integration: IntegrationItem;
  onInstallationsChanged?: () => void;
  onSecretsChanged?: () => void;
  onRequestDelete?: () => void;
  deleteDisabledReason?: string | null;
  onRequestDuplicate?: () => void;
  /**
   * `'dialog'` (default) renders inside a modal — used by the admin embed and the
   * data-source overview picker, where `/integrations/*` routes don't exist.
   * `'page'` renders as a full-page editor (parity with the generic
   * `IntegrationEditorForm`), used by the routed editor at `/integrations/:id`.
   */
  variant?: 'dialog' | 'page';
}

function getPermissionEntries(
  permissions: Record<string, string> | undefined,
): Array<[string, string]> {
  if (!permissions) return [];
  return Object.entries(permissions).sort(([a], [b]) => a.localeCompare(b));
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function purposeLabel(purpose: string | undefined): string {
  if (!purpose) return 'General';
  if (purpose === 'data-source') return 'Data Source';
  return purpose.charAt(0).toUpperCase() + purpose.slice(1);
}

function normalizeInstallHost(host: string | undefined): string | undefined {
  if (!host) return host;
  return host.toLowerCase() === 'api.github.com' ? 'github.com' : host;
}

function githubAppConnectionTestShowsRequestPath(
  message: string,
  requestPath?: string | null,
): boolean {
  if (!requestPath?.trim()) {
    return false;
  }
  if (message.toLowerCase().includes('skipped installation')) {
    return false;
  }
  return true;
}

function getActionableGithubAppErrorMessage(
  err: unknown,
  fallbackPrefix: string,
): string {
  const rawMessage = err instanceof Error ? err.message : 'Unknown error';
  const lower = rawMessage.toLowerCase();
  const isConfigIssue =
    lower.includes('configuration error') ||
    lower.includes('client_secret_ref') ||
    lower.includes('client secret') ||
    lower.includes('private key') ||
    lower.includes('kmskeyid') ||
    lower.includes('signing configuration');

  if (isConfigIssue) {
    return `GitHub App is misconfigured. Check the App ID, client secret, private key, and related settings. ${rawMessage}`;
  }

  if (err instanceof ResponseError && err.statusCode >= 500) {
    return `${fallbackPrefix} Server error. ${rawMessage}`;
  }

  if (err instanceof ResponseError && err.statusCode === 404) {
    return `${fallbackPrefix} ${rawMessage} (request path: /github-app/test)`;
  }

  return `${fallbackPrefix} ${rawMessage}`;
}

function normalizeGithubEnterpriseRestBase(input: string): string {
  const t = input.trim();
  if (!t) {
    throw new Error('Enter your GitHub Enterprise hostname or URL.');
  }
  let hostName: string;
  if (t.includes('://')) {
    try {
      hostName = new URL(t).host;
    } catch {
      throw new Error('Enter a valid URL.');
    }
  } else {
    hostName = t.split('/')[0]?.trim() ?? '';
  }
  if (!hostName) {
    throw new Error('Enter a valid hostname or URL.');
  }
  return `https://${hostName}/api/v3`;
}

export function createGithubMetadataSchema(options: {
  isEnterprise: boolean;
  hasCurrentHost: boolean;
}) {
  return z
    .object({
      name: z.string().trim().min(1, 'Name is required'),
      enterpriseServerHost: z.string(),
    })
    .superRefine((val, ctx) => {
      if (!options.isEnterprise) {
        return;
      }
      const raw = val.enterpriseServerHost.trim();
      if (!raw) {
        // An already-configured host can't be cleared; a not-yet-configured
        // one may be left blank and saved later.
        if (options.hasCurrentHost) {
          ctx.addIssue({
            code: 'custom',
            path: ['enterpriseServerHost'],
            message: 'Enterprise URL is required',
          });
        }
        return;
      }
      try {
        normalizeGithubEnterpriseRestBase(raw);
      } catch (err) {
        ctx.addIssue({
          code: 'custom',
          path: ['enterpriseServerHost'],
          message:
            err instanceof Error
              ? err.message
              : 'Enter a valid Enterprise URL.',
        });
      }
    });
}

function secretRefToSelectValue(raw?: string | null): string {
  if (!raw?.trim()) {
    return '';
  }
  const t = raw.trim();
  if (t.startsWith('${')) {
    return t;
  }
  return toSecretVariable(t);
}

function secretSelectValueToApiRef(value: string): string | undefined {
  const t = value.trim();
  if (!t) {
    return undefined;
  }
  return extractSecretName(t) ?? t;
}

function mergeGithubApps(githubApps: GithubAppInfo[]): GithubAppInfo[] {
  const merged = new Map<string, GithubAppInfo>();

  for (const app of githubApps) {
    const normalizedHost = normalizeInstallHost(app.host) ?? app.host;
    const key = `${app.appId}-${normalizedHost}`;
    const existing = merged.get(key);
    const purposes = Array.from(
      new Set([...(existing?.purposes ?? []), ...(app.purposes ?? [])]),
    );
    const mergedHost =
      existing?.host === 'github.com' || app.host === 'github.com'
        ? 'github.com'
        : (existing?.host ?? app.host);

    merged.set(key, {
      ...(existing ?? app),
      ...app,
      host: mergedHost,
      purposes: purposes.length > 0 ? purposes : undefined,
    });
  }

  return Array.from(merged.values());
}

interface AppSectionProps {
  app: GithubAppInfo;
  recordId?: string;
  canEdit?: boolean;
  open: boolean;
  onInstallationsChanged?: () => void;
  onInstallSucceeded?: () => void;
  onEdit?: () => void;
  onTestResultChange?: (input: {
    appKey: string;
    displayName: string;
    result: GithubAppConnectionTestResult | null;
  }) => void;
}

function AppSection({
  app,
  recordId: _recordId,
  canEdit,
  open,
  onInstallationsChanged,
  onInstallSucceeded,
  onEdit,
  onTestResultChange,
}: AppSectionProps) {
  const api = useWorkflows();
  const alertApi = useAlert();
  const config = useAppConfig();
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const [installing, setInstalling] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<GithubAppInstallation | null>(null);
  const [testResult, setTestResult] =
    useState<GithubAppConnectionTestResult | null>(null);
  const installChannelRef = useRef<BroadcastChannel | null>(null);

  const invalidateInstallations = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.githubAppInstallations(app.appId, app.host),
            workspaceScopeKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.githubAppInstallRequests(app.appId),
            workspaceScopeKey,
          ),
        }),
      ]),
    [queryClient, app.appId, app.host, workspaceScopeKey],
  );

  useEffect(() => {
    return () => {
      installChannelRef.current?.close();
    };
  }, []);

  const installationsQuery = useQuery({
    ...githubAppInstallationsQuery(api, app.appId, app.host),
    enabled: open,
  });
  const installationsResult = installationsQuery.data ?? {
    installations: [] as GithubAppInstallation[],
  };
  const loading = installationsQuery.isLoading;
  const error = installationsQuery.error;

  const installations = installationsResult.installations;
  const installationsWarning: GithubAppInstallationsWarning | undefined =
    installationsResult.warning;

  const pendingRequestsQuery = useQuery({
    ...githubAppInstallRequestsQuery(api, app.appId),
    enabled: open,
  });
  const pendingRequests = pendingRequestsQuery.data ?? EMPTY_INSTALL_REQUESTS;

  useEffect(() => {
    if (!open) return undefined;
    const channel = new BroadcastChannel('github-app-install');
    channel.onmessage = e => {
      if (
        e.data?.type === 'github-app-installed' ||
        e.data?.type === 'github-app-install-requested'
      ) {
        void invalidateInstallations();
      }
    };
    return () => channel.close();
  }, [open, invalidateInstallations]);

  useEffect(() => {
    if (!open || pendingRequests.length === 0) return undefined;
    const interval = setInterval(() => {
      void invalidateInstallations();
    }, 15000);
    return () => clearInterval(interval);
  }, [open, pendingRequests.length, invalidateInstallations]);

  useEffect(() => {
    if (!open) {
      setTestResult(null);
    }
  }, [open, app.appId, app.host]);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      const params = new URLSearchParams();
      if (typeof config.scope === 'string') {
        params.set('scope', config.scope);
      }
      params.set('close-after', 'true');
      const redirectUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
      const { installUrl } = await api.githubApp.getInstallLink(
        app.appId,
        redirectUrl,
        app.host,
      );

      installChannelRef.current?.close();
      const channel = new BroadcastChannel('github-app-install');
      installChannelRef.current = channel;

      channel.onmessage = e => {
        if (e.data?.type === 'github-app-installed') {
          void invalidateInstallations();
          setInstalling(false);
          onInstallationsChanged?.();
          onInstallSucceeded?.();
          alertApi.post({
            message: 'GitHub App installed successfully',
            severity: 'success',
            display: 'transient',
          });
          channel.close();
          installChannelRef.current = null;
          return;
        }

        if (e.data?.type === 'github-app-install-requested') {
          setInstalling(false);
          alertApi.post({
            message:
              'An org admin must approve this installation request. Refresh this page after approval to see the installation.',
            severity: 'info',
          });
          channel.close();
          installChannelRef.current = null;
        }
      };

      window.open(installUrl, '_blank');
    } catch (err) {
      alertApi.post({
        message: getActionableGithubAppErrorMessage(
          err,
          'Failed to start installation:',
        ),
        severity: 'error',
      });
      setInstalling(false);
    }
  }, [
    app.appId,
    app.host,
    api,
    alertApi,
    onInstallationsChanged,
    onInstallSucceeded,
    config.scope,
    invalidateInstallations,
  ]);

  const deleteInstallationMutation = useMutation({
    mutationFn: (id: string) => api.githubApp.deleteInstallation(id),
    onSuccess: invalidateInstallations,
  });

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteInstallationMutation.mutateAsync(deleteTarget.id);
      alertApi.post({
        message: 'Installation removed',
        severity: 'success',
        display: 'transient',
      });
      onInstallationsChanged?.();
    } catch (err) {
      alertApi.post({
        message: getActionableGithubAppErrorMessage(
          err,
          'Failed to remove installation:',
        ),
        severity: 'error',
      });
    }
    setDeleteTarget(null);
  }, [
    deleteTarget,
    deleteInstallationMutation,
    alertApi,
    onInstallationsChanged,
  ]);

  const testMutation = useMutation({
    mutationFn: () => api.githubApp.testApp(app.appId, app.host),
  });
  const testing = testMutation.isPending;

  const handleTest = useCallback(async () => {
    try {
      const result = await testMutation.mutateAsync();
      setTestResult(result);
      const hasErrors =
        result.appCredentials.status === 'error' ||
        Boolean(result.warning) ||
        result.installations.some(
          installation => installation.status === 'error',
        );
      alertApi.post({
        message: hasErrors
          ? 'GitHub App test completed with issues'
          : 'GitHub App test passed',
        severity: hasErrors ? 'info' : 'success',
        display: 'transient',
      });
    } catch (err) {
      alertApi.post({
        message: getActionableGithubAppErrorMessage(
          err,
          'Failed to test GitHub App:',
        ),
        severity: 'error',
      });
    }
  }, [testMutation, alertApi]);

  const displayName = app.slug ?? app.appId;
  const appKey = `${app.appId}-${normalizeInstallHost(app.host) ?? app.host}`;
  const purposes =
    app.purposes && app.purposes.length > 0 ? app.purposes : ['general'];
  const hasAppTestError = testResult?.appCredentials.status === 'error';
  const hasAppTestWarning = Boolean(testResult?.warning);
  const hasInstallationTestError =
    testResult?.installations.some(result => result.status === 'error') ??
    false;
  const hasAnyTestError =
    hasAppTestError || hasAppTestWarning || hasInstallationTestError;

  useEffect(() => {
    onTestResultChange?.({
      appKey,
      displayName,
      result: testResult,
    });
  }, [appKey, displayName, onTestResultChange, testResult]);

  const visiblePendingRequests = useMemo(() => {
    if (pendingRequests.length === 0) return [];
    const installedOrgLogins = new Set(
      installations
        .map(i => i.orgLogin?.toLowerCase())
        .filter((l): l is string => Boolean(l)),
    );
    return pendingRequests.filter(req => {
      if (!req.orgLogin) return true;
      return !installedOrgLogins.has(req.orgLogin.toLowerCase());
    });
  }, [installations, pendingRequests]);

  return (
    <>
      <div
        className={`flex flex-col gap-3 rounded-md border p-4 ${
          hasAnyTestError
            ? 'border-warning/40 bg-transparent'
            : 'border-divider bg-transparent'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Bot className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">{displayName}</span>
              {app.htmlUrl && (
                <a
                  href={app.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 pl-6">
              {purposes.map(purpose => (
                <span
                  key={purpose}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {purposeLabel(purpose)}
                </span>
              ))}
              <span className="text-xs text-muted-foreground/70">
                App ID: {app.appId}
              </span>
            </div>
            {app.description && (
              <p className="pl-6 text-xs text-muted-foreground/80">
                {app.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canEdit && onEdit && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      onClick={onEdit}
                      aria-label="Edit GitHub App"
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Edit</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={testing}
              className="disabled:bg-disabled disabled:text-disabled-foreground"
            >
              {testing && <Spinner className="mr-2 size-3" />}
              Test
            </Button>
            {testResult && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex cursor-default items-center px-1">
                      {hasAnyTestError ? (
                        <CircleAlert className="size-4 text-warning" />
                      ) : (
                        <CheckCircle2 className="size-4 text-success" />
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    variant="rich"
                    className="max-w-[300px]"
                  >
                    <div className="flex flex-col gap-1 text-xs">
                      <div className="font-medium">App credentials</div>
                      {testResult.warning && (
                        <div className="text-warning">{testResult.warning}</div>
                      )}
                      <div className="text-muted-foreground">
                        {testResult.appCredentials.message}
                      </div>
                      {githubAppConnectionTestShowsRequestPath(
                        testResult.appCredentials.message,
                        testResult.appCredentials.requestPath,
                      ) && (
                        <div className="text-muted-foreground/70">
                          Path: {testResult.appCredentials.requestPath}
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleInstall}
              disabled={installing}
              className="disabled:bg-disabled disabled:text-disabled-foreground"
            >
              {installing && <Spinner className="mr-2 size-3" />}
              Install
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Installations
          </span>

          {loading && (
            <div className="flex items-center gap-2 py-3">
              <Spinner className="size-4" />
              <span className="text-sm text-muted-foreground">
                Loading installations...
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              Failed to load: {error.message || 'Unknown error'}
            </div>
          )}

          {!loading && !error && installationsWarning && (
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{installationsWarning.message}</span>
            </div>
          )}

          {!loading && !error && visiblePendingRequests.length > 0 && (
            <div className="flex flex-col divide-y divide-divider">
              {visiblePendingRequests.map(req => (
                <div key={req.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                    <Clock className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {req.orgLogin ?? 'Awaiting admin approval'}
                      </span>
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                        Pending approval
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Requested {formatDate(req.createdAt)}. An organization
                      admin must approve this installation in GitHub. The
                      installation will appear here automatically once approved.
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading &&
            !error &&
            installations.length === 0 &&
            visiblePendingRequests.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-divider py-4">
                <Building2 className="size-6 text-muted-foreground/50" />
                <span className="text-xs text-muted-foreground">
                  No installations yet
                </span>
              </div>
            )}

          {!loading && installations.length > 0 && (
            <div className="flex flex-col divide-y divide-divider">
              {installations.map(inst => {
                const permissionEntries = getPermissionEntries(
                  inst.permissions,
                );
                const visiblePermissionEntries = permissionEntries.slice(0, 3);
                const hiddenPermissionsCount =
                  permissionEntries.length - visiblePermissionEntries.length;

                return (
                  <div
                    key={inst.id}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    {inst.avatarUrl ? (
                      <img
                        src={inst.avatarUrl}
                        alt={inst.orgLogin ?? 'org'}
                        className="size-8 rounded-full"
                      />
                    ) : (
                      <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                        <Building2 className="size-4 text-muted-foreground" />
                      </div>
                    )}

                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {inst.orgLogin ?? 'GitHub account'}
                        </span>
                        {inst.orgUrl && (
                          <a
                            href={inst.orgUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {inst.repoSelection && (
                          <span className="flex items-center gap-1">
                            <GitFork className="size-3" />
                            {inst.repoSelection === 'all'
                              ? 'All repositories'
                              : 'Selected repositories'}
                          </span>
                        )}
                        <span>Installed {formatDate(inst.createdAt)}</span>
                      </div>
                      {permissionEntries.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {visiblePermissionEntries.map(
                            ([permission, level]) => (
                              <span
                                key={`${inst.id}-${permission}`}
                                className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                {permission}: {level}
                              </span>
                            ),
                          )}
                          {hiddenPermissionsCount > 0 && (
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-default rounded-full border border-divider px-2 py-0.5 text-[11px] text-muted-foreground/80">
                                    +{hiddenPermissionsCount} more
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent
                                  variant="rich"
                                  className="max-w-[400px]"
                                >
                                  <div className="flex max-w-[380px] flex-wrap gap-1.5">
                                    {permissionEntries.map(
                                      ([permission, level]) => (
                                        <span
                                          key={`${inst.id}-tooltip-${permission}`}
                                          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                                        >
                                          {permission}: {level}
                                        </span>
                                      ),
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}
                    </div>

                    {(() => {
                      const installTestResult = testResult?.installations.find(
                        r => r.installationId === inst.installationId,
                      );
                      if (!installTestResult) return null;
                      return (
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex cursor-default items-center px-0.5">
                                {installTestResult.status === 'success' ? (
                                  <CheckCircle2 className="size-4 text-success" />
                                ) : (
                                  <CircleAlert className="size-4 text-warning" />
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="left"
                              variant="rich"
                              className="max-w-[300px]"
                            >
                              <div className="flex flex-col gap-1 text-xs">
                                <div
                                  className={
                                    installTestResult.status === 'success'
                                      ? 'text-muted-foreground'
                                      : 'text-warning'
                                  }
                                >
                                  {installTestResult.message}
                                </div>
                                {githubAppConnectionTestShowsRequestPath(
                                  installTestResult.message,
                                  installTestResult.requestPath,
                                ) && (
                                  <div className="text-muted-foreground/70">
                                    Path: {installTestResult.requestPath}
                                  </div>
                                )}
                                {installTestResult.repositoryCount !==
                                  undefined && (
                                  <div className="text-muted-foreground/70">
                                    Repositories:{' '}
                                    {installTestResult.repositoryCount}
                                  </div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })()}

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(inst)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmationDialog
        open={!!deleteTarget}
        title="Uninstall from GitHub"
        contentText={`Are you sure you want to uninstall "${deleteTarget?.orgLogin ?? 'this GitHub account'}" from GitHub? This will remove the GitHub App installation from your organization and cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        isDelete
        confirmButtonText="Uninstall"
      />
    </>
  );
}

const GITHUB_APP_FORM_PURPOSES = ['data-source'] as const;

interface AppEditFormProps {
  integrationId: string;
  integrationSlug: string;
  integrationHostConfigured: boolean;
  initialApp?: GithubAppRecord;
  onSaved: (app: GithubAppRecord) => void;
  onCancel: () => void;
  onDeleted?: () => void;
  onSecretsChanged?: () => void;
  templateRegistration?: {
    registrationUrl: string | null;
    summary: string;
    tooltip: string;
    onOpenRegistration: () => void;
  };
}

// A URL or bare hostname the backend can extract a host from — mirrors the
// server's parseGithubEnterpriseHostnameInput and the metadata-save path's
// normalizeGithubEnterpriseRestBase, so the create path rejects the same
// invalid input instead of sending it and surfacing a server error as a toast.
function githubEnterpriseHostIsValid(value: string): boolean {
  const t = value.trim();
  if (!t) {
    return false;
  }
  if (t.includes('://')) {
    try {
      return Boolean(new URL(t).host);
    } catch {
      return false;
    }
  }
  return Boolean(t.split('/')[0]?.trim());
}

export function createGithubAppSchema(options: {
  isEdit: boolean;
  requireEnterpriseHost: boolean;
}) {
  return z
    .object({
      appId: z.string().trim().min(1, 'App ID is required'),
      slug: z.string().trim().min(1, 'Slug is required'),
      htmlUrl: z.string().trim(),
      clientId: z.string().trim(),
      enterpriseServerHost: z.string().trim(),
      description: z.string().trim(),
      privateKeySelect: z.string(),
      clientSecretSelect: z.string(),
      webhookSecretSelect: z.string(),
    })
    .superRefine((val, ctx) => {
      if (!options.isEdit && !val.clientId) {
        ctx.addIssue({
          code: 'custom',
          path: ['clientId'],
          message: 'Client ID is required',
        });
      }
      if (secretSelectValueToApiRef(val.privateKeySelect) === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['privateKeySelect'],
          message: 'Private key secret is required',
        });
      }
      if (secretSelectValueToApiRef(val.clientSecretSelect) === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['clientSecretSelect'],
          message: 'Client secret is required',
        });
      }
      if (options.requireEnterpriseHost) {
        if (!val.enterpriseServerHost) {
          ctx.addIssue({
            code: 'custom',
            path: ['enterpriseServerHost'],
            message:
              'Enter your GitHub Enterprise hostname (or save the integration URL above first)',
          });
        } else if (!githubEnterpriseHostIsValid(val.enterpriseServerHost)) {
          ctx.addIssue({
            code: 'custom',
            path: ['enterpriseServerHost'],
            message: 'Enter a valid hostname or URL.',
          });
        }
      }
    });
}

type GithubAppFormValues = z.input<ReturnType<typeof createGithubAppSchema>>;

function AppEditForm({
  integrationId,
  integrationSlug,
  integrationHostConfigured,
  initialApp,
  onSaved,
  onCancel,
  onDeleted,
  onSecretsChanged,
  templateRegistration,
}: AppEditFormProps) {
  const api = useWorkflows();
  const alertApi = useAlert();
  const secretsApi = useSecrets();
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const isEdit = !!initialApp;
  const requireEnterpriseHost =
    !isEdit &&
    integrationSlug === 'github-enterprise-app' &&
    !integrationHostConfigured;

  const secretKeysQ = useQuery(secretKeysQuery(secretsApi));
  const secretMetadataQ = useQuery(secretMetadataQuery(secretsApi));
  const secretCatalog = useMemo(
    () => ({
      keys: secretKeysQ.data ?? [],
      metadata: secretMetadataQ.data ?? [],
    }),
    [secretKeysQ.data, secretMetadataQ.data],
  );
  const secretStorageMode =
    useQuery(secretStorageModeQuery(secretsApi)).data ?? DEFAULT_STORAGE_MODE;
  const secretOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...(secretCatalog?.keys ?? []).map(secret => secret.name),
          ...(secretCatalog?.metadata ?? []).map(secret => secret.name),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [secretCatalog],
  );
  const reservedSecretNames = useMemo(
    () => secretStorageMode?.hiddenSecretRefs ?? [],
    [secretStorageMode],
  );
  const secretsListReadOnly = secretStorageMode?.readOnly ?? false;

  const refreshSecretList = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.secretKeys,
        workspaceScopeKey,
      ),
    });
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.secretMetadata,
        workspaceScopeKey,
      ),
    });
  }, [queryClient, workspaceScopeKey]);

  const schema = useMemo(
    () => createGithubAppSchema({ isEdit, requireEnterpriseHost }),
    [isEdit, requireEnterpriseHost],
  );
  const form = useZodForm({
    schema,
    defaultValues: {
      appId: initialApp?.appId ?? '',
      slug: initialApp?.slug ?? '',
      htmlUrl: initialApp?.htmlUrl ?? '',
      clientId: initialApp?.clientId ?? '',
      enterpriseServerHost: '',
      description: initialApp?.description ?? '',
      privateKeySelect: secretRefToSelectValue(initialApp?.privateKeyRef),
      clientSecretSelect: secretRefToSelectValue(initialApp?.clientSecretRef),
      webhookSecretSelect: secretRefToSelectValue(initialApp?.webhookSecretRef),
    } satisfies GithubAppFormValues,
  });
  const { isSubmitting } = form.formState;
  const rootError = form.formState.errors.root?.message;

  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSubmit = form.handleSubmit(async values => {
    form.clearErrors('root');
    const purposes = [...GITHUB_APP_FORM_PURPOSES];
    const secretPayload = {
      privateKeyRef: secretSelectValueToApiRef(values.privateKeySelect) ?? null,
      webhookSecretRef:
        secretSelectValueToApiRef(values.webhookSecretSelect) ?? null,
      clientSecretRef:
        secretSelectValueToApiRef(values.clientSecretSelect) ?? null,
    };
    try {
      let saved: GithubAppRecord;
      if (isEdit && initialApp) {
        saved = await api.githubApp.updateApp(initialApp.id, {
          appId: values.appId,
          slug: values.slug || null,
          htmlUrl: values.htmlUrl || null,
          description: values.description || null,
          purposes,
          ...secretPayload,
          clientId: values.clientId || null,
        });
      } else {
        saved = await api.githubApp.createApp({
          integrationId,
          appId: values.appId,
          slug: values.slug || null,
          htmlUrl: values.htmlUrl || null,
          description: values.description || null,
          purposes,
          ...secretPayload,
          clientId: values.clientId || null,
          // The backend extracts the host from this raw value; the schema has
          // already rejected syntactically invalid input above.
          ...(requireEnterpriseHost
            ? { enterpriseServerHost: values.enterpriseServerHost }
            : {}),
        });
      }
      alertApi.post({
        message: isEdit ? 'GitHub App updated' : 'GitHub App added',
        severity: 'success',
        display: 'transient',
      });
      onSaved(saved);
    } catch (err) {
      form.setError('root', {
        message:
          err instanceof Error ? err.message : 'Failed to save GitHub App',
      });
    }
  });

  const deleteAppMutation = useInvalidatingMutation({
    mutationFn: (id: string) => api.githubApp.deleteApp(id),
    invalidates: [queryKeys.githubApps(integrationId)],
  });

  const handleDelete = useCallback(async () => {
    if (!initialApp) {
      return;
    }
    try {
      await deleteAppMutation.mutateAsync(initialApp.id);
      alertApi.post({
        message: 'GitHub App removed',
        severity: 'success',
        display: 'transient',
      });
      onDeleted?.();
    } catch (err) {
      alertApi.post({
        message:
          err instanceof Error ? err.message : 'Failed to remove GitHub App',
        severity: 'error',
      });
      // Keep the confirmation dialog open on failure.
      throw err;
    }
  }, [alertApi, deleteAppMutation, initialApp, onDeleted]);

  // Hand-rolled card surface: declare its field background so nested
  // floating-label notches match the card (not the gray page background).
  return (
    <div className="flex flex-col gap-3 rounded-md border border-divider bg-card p-4 shadow-sm [--field-bg:var(--color-card)]">
      <div className="text-sm font-medium text-foreground">
        {isEdit ? 'Edit GitHub App' : 'Add GitHub App'}
      </div>

      {!isEdit && templateRegistration && (
        <div className="flex flex-col gap-2 border-b border-divider pb-3">
          <Button
            type="button"
            variant="outline"
            onClick={templateRegistration.onOpenRegistration}
            disabled={!templateRegistration.registrationUrl}
          >
            <ExternalLink className="mr-1.5 size-4" />
            Create from template
          </Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{templateRegistration.summary}</span>
            {templateRegistration.registrationUrl && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="motion-colors size-6 shrink-0 text-muted-foreground/80 hover:text-foreground"
                      aria-label="Template registration help"
                    >
                      <CircleHelp className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent variant="rich" className="max-w-[320px]">
                    <p className="text-xs leading-5">
                      {templateRegistration.tooltip}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={handleSubmit} className="contents" noValidate>
          <fieldset
            disabled={isSubmitting}
            className="flex min-w-0 flex-col gap-3 border-0 p-0"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="appId"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormControl>
                      <OutlinedInput label="App ID *" {...field} />
                    </FormControl>
                    <FormDescription>
                      From the GitHub App&apos;s general settings (numeric ID).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormControl>
                      <OutlinedInput label="Slug *" {...field} />
                    </FormControl>
                    <FormDescription>
                      Short name in URLs, e.g. my-org-roadie.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="htmlUrl"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormControl>
                      <OutlinedInput label="App URL" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label={isEdit ? 'Client ID' : 'Client ID *'}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {requireEnterpriseHost && (
              <FormField
                control={form.control}
                name="enterpriseServerHost"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Enterprise hostname or URL *"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Required until the integration API URL is saved above.
                      Must match your GitHub Enterprise Server hostname (e.g.
                      ghe.mycompany.com).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="space-y-1">
                  <FormControl>
                    <OutlinedInput label="Description" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="privateKeySelect"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <IntegrationSecretOutlinedSelect
                      label="Private key secret *"
                      value={field.value}
                      onValueChange={field.onChange}
                      secretOptions={secretOptions}
                      reservedSecretNames={reservedSecretNames}
                      onSecretListChanged={refreshSecretList}
                      secretsListReadOnly={secretsListReadOnly}
                      onSecretsChanged={onSecretsChanged}
                      suggestedSecretName="GITHUB_APP_PRIVATE_KEY"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="clientSecretSelect"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <IntegrationSecretOutlinedSelect
                      label="Client secret *"
                      value={field.value}
                      onValueChange={field.onChange}
                      secretOptions={secretOptions}
                      reservedSecretNames={reservedSecretNames}
                      onSecretListChanged={refreshSecretList}
                      secretsListReadOnly={secretsListReadOnly}
                      onSecretsChanged={onSecretsChanged}
                      suggestedSecretName="GITHUB_APP_CLIENT_SECRET"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="webhookSecretSelect"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <IntegrationSecretOutlinedSelect
                      label="Webhook secret"
                      value={field.value}
                      onValueChange={field.onChange}
                      secretOptions={secretOptions}
                      reservedSecretNames={reservedSecretNames}
                      onSecretListChanged={refreshSecretList}
                      secretsListReadOnly={secretsListReadOnly}
                      onSecretsChanged={onSecretsChanged}
                      suggestedSecretName="GITHUB_APP_WEBHOOK_SECRET"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {rootError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {rootError}
              </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                {isEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                    disabled={isSubmitting}
                  >
                    <Trash2 className="mr-1.5 size-4" />
                    Remove
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="disabled:bg-disabled disabled:text-disabled-foreground"
                >
                  {isSubmitting && <Spinner className="mr-2 size-4" />}
                  {isEdit ? 'Save Changes' : 'Add GitHub App'}
                </Button>
              </div>
            </div>
          </fieldset>
        </form>
      </Form>

      <ConfirmationDialog
        open={confirmDelete}
        title="Remove GitHub App"
        contentText={`Remove "${initialApp?.slug ?? initialApp?.appId}" from this integration? Any installations of this app will also be removed from Roadie's records (uninstall in GitHub separately to revoke access).`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        isDelete
        confirmButtonText="Remove"
      />
    </div>
  );
}

// Stable empty reference so the app-derived memos don't churn while the apps
// query is idle or unresolved.
const EMPTY_APP_RECORDS: GithubAppRecord[] = [];
const EMPTY_INSTALL_REQUESTS: GithubAppInstallRequest[] = [];
// Fallback while the storage-mode query is loading or errored.
const DEFAULT_STORAGE_MODE = {
  mode: 'dotenv' as const,
  readOnly: false,
  hiddenSecretRefs: [],
};

function recordToInfo(record: GithubAppRecord): GithubAppInfo {
  return {
    appId: record.appId,
    host: record.host,
    purposes: record.purposes,
    slug: record.slug,
    htmlUrl: record.htmlUrl,
    description: record.description,
    privateKeyRef: record.privateKeyRef,
    clientSecretRef: record.clientSecretRef,
    kmsKeyId: record.kmsKeyId,
  };
}

export function GitHubIntegrationDialog({
  open,
  onClose,
  integration,
  onInstallationsChanged,
  onSecretsChanged,
  onRequestDelete,
  deleteDisabledReason,
  onRequestDuplicate,
  variant = 'dialog',
}: GitHubIntegrationDialogProps) {
  const api = useWorkflows();
  const alertApi = useAlert();
  const config = useAppConfig();
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const isEnterpriseApp = integration.slug === 'github-enterprise-app';
  const currentHost = (integration.host ?? '').trim();
  const isPreBuiltIntegration = integration.createdBy === 'system';
  const { hasMatchingSeeds, matchingSeedNames } = useHasMatchingDataSourceSeeds(
    variant === 'page' && isPreBuiltIntegration ? integration.slug : undefined,
  );
  const showAutoEnableToggle =
    variant === 'page' && isPreBuiltIntegration && hasMatchingSeeds;
  const [autoEnableSeeds, setAutoEnableSeeds] = useState(true);
  const { activate } = useSeedActivation();

  const notifyInstallationsChanged = useCallback(() => {
    onInstallationsChanged?.();
  }, [onInstallationsChanged]);

  const activateSeedsIfEnabled = useCallback(() => {
    if (showAutoEnableToggle && autoEnableSeeds) {
      void activate(integration.id);
    }
  }, [showAutoEnableToggle, autoEnableSeeds, activate, integration.id]);

  const notifySetupCompleted = useCallback(() => {
    notifyInstallationsChanged();
    activateSeedsIfEnabled();
  }, [notifyInstallationsChanged, activateSeedsIfEnabled]);

  const invalidateApps = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeyInScope(
          queryKeys.githubApps(integration.id),
          workspaceScopeKey,
        ),
      }),
    [queryClient, integration.id, workspaceScopeKey],
  );

  const metadataSchema = useMemo(
    () =>
      createGithubMetadataSchema({
        isEnterprise: isEnterpriseApp,
        hasCurrentHost: Boolean(currentHost),
      }),
    [isEnterpriseApp, currentHost],
  );
  const metadataForm = useZodForm({
    schema: metadataSchema,
    defaultValues: {
      name: integration.name,
      enterpriseServerHost: currentHost,
    },
  });
  const metadataFormId = React.useId();
  // Alias the live field values under their old names so the derived
  // template-link / title / focus logic below reads them unchanged.
  const integrationNameDraft = metadataForm.watch('name');
  const enterpriseHostInput = metadataForm.watch('enterpriseServerHost');
  const savingMetadata = metadataForm.formState.isSubmitting;

  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [creatingApp, setCreatingApp] = useState(false);
  const [appTestResultsByKey, setAppTestResultsByKey] = useState<
    Record<
      string,
      {
        displayName: string;
        result: GithubAppConnectionTestResult;
      }
    >
  >({});

  const githubDialogTitleRef = useRef<HTMLHeadingElement | null>(null);

  // Re-seed only when opening or switching to a different integration — NOT
  // when the same integration's name/host change under a background refetch,
  // so in-progress edits on the always-open page variant survive (I9).
  useEffect(() => {
    if (open) {
      metadataForm.reset({
        name: integration.name,
        enterpriseServerHost: (integration.host ?? '').trim(),
      });
    } else {
      setAppTestResultsByKey({});
    }
    // integration.name/host intentionally excluded from deps — see comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, integration.id]);

  const displayHost = integration.host;
  const integrationHostConfigured = Boolean((displayHost ?? '').trim());
  const templateRegistrationUrl = useMemo(
    () =>
      buildGithubAppTemplateRegistrationUrl({
        integrationSlug: integration.slug,
        integrationHost:
          integration.slug === 'github-enterprise-app'
            ? enterpriseHostInput.trim() || displayHost
            : displayHost,
        appBaseUrl: config.app.baseUrl,
        backendBaseUrl: config.backend.baseUrl,
        scope: typeof config.scope === 'string' ? config.scope : undefined,
      }),
    [
      config.app.baseUrl,
      config.backend.baseUrl,
      config.scope,
      displayHost,
      enterpriseHostInput,
      integration.slug,
    ],
  );
  const templateLinkSummary = useMemo(() => {
    if (
      templateRegistrationUrl ||
      integration.slug !== 'github-enterprise-app'
    ) {
      return "Uses Roadie's recommended defaults.";
    }
    if (enterpriseHostInput.trim()) {
      return 'Enter a valid GitHub Enterprise URL to use the template.';
    }
    return 'Enter your GitHub Enterprise URL to use the template.';
  }, [enterpriseHostInput, integration.slug, templateRegistrationUrl]);
  const templateLinkTooltip = useMemo(() => {
    const base =
      "Prefills Roadie's recommended name, callback URL, webhook URL, permissions, and events. After creating the app, copy the App ID, slug, Client ID, private key, client secret, and webhook secret back here.";
    const scopeTrimmed =
      typeof config.scope === 'string' ? config.scope.trim() : '';
    const mtCallback = scopeTrimmed
      ? ' Replace {appId} in the callback URL with your numeric GitHub App ID after the app is created.'
      : '';
    return base + mtCallback;
  }, [config.scope]);

  const handleMetadataSubmit = metadataForm.handleSubmit(async values => {
    metadataForm.clearErrors('root');
    const nameTrimmed = values.name.trim();
    const nameChanged = nameTrimmed !== integration.name.trim();

    let hostChanged = false;
    let normalizedHost: string | undefined;
    if (isEnterpriseApp) {
      const raw = values.enterpriseServerHost.trim();
      if (raw) {
        // The schema has already validated that this normalizes cleanly.
        const normalized = normalizeGithubEnterpriseRestBase(raw);
        hostChanged = normalized !== currentHost;
        if (hostChanged) {
          normalizedHost = normalized;
        }
      }
    }

    if (!nameChanged && !hostChanged) {
      return;
    }

    try {
      const payload: { name?: string; host?: string } = {};
      if (nameChanged) {
        payload.name = nameTrimmed;
      }
      if (hostChanged && normalizedHost) {
        payload.host = normalizedHost;
      }

      const result = await api.integrations.update(integration.id, payload);
      metadataForm.reset({
        name: result.name,
        enterpriseServerHost: (result.host ?? '').trim(),
      });

      alertApi.post({
        message: 'Integration updated',
        severity: 'success',
        display: 'transient',
      });
      notifySetupCompleted();
    } catch (err) {
      metadataForm.setError('root', {
        message:
          err instanceof Error ? err.message : 'Failed to save integration',
      });
    }
  });

  const handleOpenTemplateRegistration = useCallback(() => {
    if (!templateRegistrationUrl) {
      alertApi.post({
        message:
          integration.slug === 'github-enterprise-app'
            ? enterpriseHostInput.trim()
              ? 'Enter a valid GitHub Enterprise URL above before creating from template'
              : 'Enter your GitHub Enterprise URL above before creating from template'
            : 'Template link is unavailable',
        severity: 'error',
      });
      return;
    }

    window.open(templateRegistrationUrl, '_blank', 'noopener,noreferrer');
  }, [
    alertApi,
    enterpriseHostInput,
    integration.slug,
    templateRegistrationUrl,
  ]);

  const appsQuery = useQuery({
    ...githubAppsQuery(api, integration.id),
    enabled: open,
  });
  const appRecords = appsQuery.data ?? EMPTY_APP_RECORDS;
  const appsLoading = appsQuery.isLoading;
  const appsError = appsQuery.error;

  const githubApps = useMemo(() => {
    const fromRecords: GithubAppInfo[] = appRecords.map(recordToInfo);
    if (fromRecords.length > 0) {
      return mergeGithubApps(fromRecords);
    }
    return mergeGithubApps(
      (integration.extensions?.githubApps as GithubAppInfo[] | undefined) ?? [],
    );
  }, [appRecords, integration.extensions]);

  const recordsByAppId = useMemo(() => {
    const map = new Map<string, GithubAppRecord>();
    for (const record of appRecords) {
      const normalizedHost = normalizeInstallHost(record.host) ?? record.host;
      map.set(`${record.appId}-${normalizedHost}`, record);
    }
    return map;
  }, [appRecords]);

  const handleAppSaved = useCallback(() => {
    setEditingAppId(null);
    setCreatingApp(false);
    void invalidateApps();
    notifySetupCompleted();
  }, [invalidateApps, notifySetupCompleted]);

  const handleAppDeleted = useCallback(() => {
    setEditingAppId(null);
    void invalidateApps();
    notifyInstallationsChanged();
  }, [invalidateApps, notifyInstallationsChanged]);

  const handleAppTestResultChange = useCallback(
    (input: {
      appKey: string;
      displayName: string;
      result: GithubAppConnectionTestResult | null;
    }) => {
      setAppTestResultsByKey(prev => {
        if (!input.result) {
          if (!prev[input.appKey]) {
            return prev;
          }
          const next = { ...prev };
          delete next[input.appKey];
          return next;
        }
        return {
          ...prev,
          [input.appKey]: {
            displayName: input.displayName,
            result: input.result,
          },
        };
      });
    },
    [],
  );

  const requiredSecretRefs = useMemo(
    () => getIntegrationRequiredSecretRefs(integration),
    [integration],
  );

  const metadataDirty = metadataForm.formState.isDirty;
  const metadataValid = metadataForm.formState.isValid;
  const metadataRootError = metadataForm.formState.errors.root?.message;
  const metadataSaveDisabled =
    savingMetadata || !metadataValid || !metadataDirty;

  // Page mode has no Dialog `onOpenAutoFocus`, so replicate its initial-focus
  // intent on mount: the name field when empty, else the enterprise URL when
  // it still needs attention.
  useEffect(() => {
    if (variant !== 'page') return;
    const run = () =>
      requestAnimationFrame(() => {
        if (!integrationNameDraft.trim()) {
          metadataForm.setFocus('name');
        } else if (isEnterpriseApp && !metadataValid) {
          metadataForm.setFocus('enterpriseServerHost');
        }
      });
    requestAnimationFrame(() => requestAnimationFrame(run));
    // Mount-only: focus once when the page opens, matching the dialog's behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  const showGithubAppsEmptyState =
    !appsLoading &&
    !appsError &&
    githubApps.length === 0 &&
    !creatingApp &&
    !editingAppId;
  const appCredentialTestErrors = Object.values(appTestResultsByKey).filter(
    entry => entry.result.appCredentials.status === 'error',
  );

  const githubAddAppButton = (
    <Button
      type="button"
      variant="ghost"
      className="px-0 text-primary hover:bg-transparent"
      onClick={() => setCreatingApp(true)}
    >
      <Plus className="mr-1.5 size-4" />
      Add GitHub App
    </Button>
  );

  // Shared editor body (secrets, name, connection, GitHub Apps). Rendered inside
  // either the dialog shell (admin embed / data-source picker) or the full-page
  // shell (routed editor) below — kept identical so the two modes never drift.
  const content = (
    <>
      {requiredSecretRefs.length > 0 && (
        <div className="mb-5">
          <RequiredSecretsPanel
            secretRefs={requiredSecretRefs}
            onSecretsChanged={onSecretsChanged}
          />
        </div>
      )}
      {appCredentialTestErrors.length > 0 && (
        <div className="mb-5 rounded-md border border-warning/40 bg-warning/10 p-3">
          <div className="mb-2 flex items-start gap-2 text-sm font-medium text-warning">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            GitHub App test issues
          </div>
          <div className="flex flex-col gap-2">
            {appCredentialTestErrors.map(({ displayName, result }) => (
              <div
                key={`${displayName}-${result.appId}-${result.host}`}
                className="text-xs text-warning"
              >
                <span className="font-medium">{displayName}:</span>{' '}
                {result.appCredentials.message}
                {githubAppConnectionTestShowsRequestPath(
                  result.appCredentials.message,
                  result.appCredentials.requestPath,
                ) && (
                  <span className="text-warning/90">
                    {' '}
                    (Path: {result.appCredentials.requestPath})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-5">
        <Form {...metadataForm}>
          <form
            id={metadataFormId}
            onSubmit={handleMetadataSubmit}
            className="contents"
            noValidate
          >
            <fieldset
              disabled={savingMetadata}
              className="flex min-w-0 flex-col gap-5 border-0 p-0"
            >
              {/* Enter in a field submits via this associated (but visually
                  hidden) button; the page variant's Save lives in the header.
                  The disabled fieldset also blocks Enter re-submits mid-save. */}
              <Button
                type="submit"
                className="hidden"
                tabIndex={-1}
                aria-hidden
              />
              <FormField
                control={metadataForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Name *"
                        className="bg-background"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormSection title="Connection" />
              {isEnterpriseApp ? (
                <FormField
                  control={metadataForm.control}
                  name="enterpriseServerHost"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormControl>
                        <OutlinedInput
                          label="URL *"
                          className="bg-background"
                          placeholder={
                            enterpriseHostInput.trim()
                              ? ' '
                              : INTEGRATION_HTTP_BASE_URL_PLACEHOLDER
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        GitHub Enterprise Server hostname or URL. Saved as the
                        REST API base (for example{' '}
                        <span className="font-mono text-[0.8rem]">
                          https://github.company.com/api/v3
                        </span>
                        ).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <OutlinedInput
                  label="URL"
                  value={displayHost ?? ''}
                  disabled
                  className="bg-background"
                />
              )}

              {metadataRootError && (
                <p
                  role="alert"
                  className="text-sm font-medium text-destructive"
                >
                  {metadataRootError}
                </p>
              )}
            </fieldset>
          </form>
        </Form>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Blocks className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  GitHub Apps
                  {githubApps.length > 0 && (
                    <span className="ml-1.5 font-normal text-muted-foreground/70">
                      ({githubApps.length})
                    </span>
                  )}
                </span>
              </div>
              <p className="max-w-[34rem] text-xs leading-5 text-muted-foreground/70">
                Recommended over tokens for more consistent permissions and
                higher API rate limits.
              </p>
            </div>
          </div>

          {appsLoading && (
            <div className="flex items-center gap-2 py-3">
              <Spinner className="size-4" />
              <span className="text-sm text-muted-foreground">
                Loading GitHub Apps...
              </span>
            </div>
          )}

          {appsError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              Failed to load GitHub Apps: {appsError.message || 'Unknown error'}
            </div>
          )}

          {showGithubAppsEmptyState && (
            <div className="rounded-lg border border-dashed border-divider bg-muted/20 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-divider bg-background">
                  <Blocks className="size-5 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    No GitHub Apps linked yet
                  </p>
                  <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                    Use Add GitHub App below to register credentials and enable
                    org-scoped installation tokens.
                  </p>
                </div>
              </div>
            </div>
          )}

          {githubApps.map(app => {
            const normalizedHost = normalizeInstallHost(app.host) ?? app.host;
            const record = recordsByAppId.get(`${app.appId}-${normalizedHost}`);
            const isEditingThis = !!record && editingAppId === record.id;
            if (isEditingThis && record) {
              return (
                <AppEditForm
                  key={`edit-${record.id}`}
                  integrationId={integration.id}
                  integrationSlug={integration.slug}
                  integrationHostConfigured={integrationHostConfigured}
                  initialApp={record}
                  onSaved={handleAppSaved}
                  onCancel={() => setEditingAppId(null)}
                  onDeleted={handleAppDeleted}
                  onSecretsChanged={onSecretsChanged}
                />
              );
            }
            return (
              <AppSection
                key={`${app.appId}-${app.host}`}
                app={app}
                recordId={record?.id}
                canEdit={!!record}
                open={open}
                onInstallationsChanged={notifyInstallationsChanged}
                onInstallSucceeded={activateSeedsIfEnabled}
                onEdit={record ? () => setEditingAppId(record.id) : undefined}
                onTestResultChange={handleAppTestResultChange}
              />
            );
          })}

          {!creatingApp && !editingAppId && (
            <div className="w-full max-w-full sm:w-auto sm:min-w-[220px]">
              {githubAddAppButton}
            </div>
          )}

          {creatingApp && (
            <AppEditForm
              integrationId={integration.id}
              integrationSlug={integration.slug}
              integrationHostConfigured={integrationHostConfigured}
              onSaved={handleAppSaved}
              onCancel={() => setCreatingApp(false)}
              onSecretsChanged={onSecretsChanged}
              templateRegistration={{
                registrationUrl: templateRegistrationUrl,
                summary: templateLinkSummary,
                tooltip: templateLinkTooltip,
                onOpenRegistration: handleOpenTemplateRegistration,
              }}
            />
          )}
        </div>
      </div>
    </>
  );

  const dialogHeaderActions =
    onRequestDelete || onRequestDuplicate ? (
      <TooltipProvider delayDuration={300}>
        <div className="flex shrink-0 items-center gap-0.5">
          {onRequestDuplicate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  aria-label="Duplicate integration"
                  onClick={() => onRequestDuplicate()}
                >
                  <Copy className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Duplicate integration
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onRequestDelete ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete integration"
                    disabled={!!deleteDisabledReason}
                    onClick={() => onRequestDelete()}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {deleteDisabledReason
                  ? deleteDisabledReason
                  : 'Delete integration'}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </TooltipProvider>
    ) : null;

  // Full-page header actions mirror IntegrationEditorForm: labeled Duplicate /
  // Delete buttons. Save is first-class on the EditorHeader (see below), and the
  // dialog footer's Cancel is dropped in page mode — the back arrow returns to
  // the list.
  const pageHeaderActions =
    onRequestDuplicate || onRequestDelete ? (
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-2">
          {onRequestDuplicate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRequestDuplicate()}
                >
                  <Copy className="size-4" />
                  Duplicate
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Duplicate integration
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onRequestDelete ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={!!deleteDisabledReason}
                    onClick={() => onRequestDelete()}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {deleteDisabledReason
                  ? deleteDisabledReason
                  : 'Delete integration'}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </TooltipProvider>
    ) : undefined;

  if (variant === 'page') {
    return (
      // Fields render on the page background here (not a card), so the
      // outlined-field labels must mask their border with the background
      // colour — otherwise the floating labels show a card-coloured notch.
      <EntityEditorShell
        style={
          { '--field-bg': 'var(--color-background)' } as React.CSSProperties
        }
      >
        <EntityEditorHeader
          section="integrations"
          title={integrationNameDraft.trim() || integration.name}
          logoUrl={integration.logoUrl}
          saveState="manual"
          isDirty={metadataDirty}
          saving={savingMetadata}
          onSave={() => void handleMetadataSubmit()}
          saveDisabled={metadataSaveDisabled}
          saveLabel="Save"
          actions={pageHeaderActions}
        />
        <EntityEditorFormBody>
          {showAutoEnableToggle && (
            <AutoEnableDataSourcesToggle
              checked={autoEnableSeeds}
              onCheckedChange={setAutoEnableSeeds}
              seedNames={matchingSeedNames}
            />
          )}
          {content}
        </EntityEditorFormBody>
      </EntityEditorShell>
    );
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100vh-64px)] max-w-[620px] flex-col gap-0 overflow-hidden border-none bg-surface px-0 py-px shadow-md"
        // Dialog surface is surface-coloured; mask the label notches to match.
        style={{ '--field-bg': 'var(--color-surface)' } as React.CSSProperties}
        hideCloseButton
        onOpenAutoFocus={e => {
          e.preventDefault();
          const run = () => {
            requestAnimationFrame(() => {
              if (!integrationNameDraft.trim()) {
                metadataForm.setFocus('name');
              } else if (isEnterpriseApp && !metadataValid) {
                metadataForm.setFocus('enterpriseServerHost');
              } else {
                githubDialogTitleRef.current?.focus({ preventScroll: true });
              }
            });
          };
          requestAnimationFrame(() => {
            requestAnimationFrame(run);
          });
        }}
      >
        <DialogHeader className="shrink-0 space-y-0 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle
              ref={githubDialogTitleRef}
              tabIndex={-1}
              className="min-w-0 flex-1 text-left text-base leading-[1.6] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Edit Integration
            </DialogTitle>
            {dialogHeaderActions}
          </div>
        </DialogHeader>

        <div className="mt-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-b border-divider px-6 pt-4 pb-[15px]">
            {content}
          </div>
        </div>

        <DialogFooter className="z-10 shrink-0 border-t border-divider bg-surface px-6 py-4">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2">
            <Button
              type="button"
              variant="ghost"
              className="text-primary"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={metadataFormId}
              disabled={metadataSaveDisabled}
              className="disabled:bg-disabled disabled:text-disabled-foreground"
            >
              {savingMetadata && <Spinner className="mr-2 size-4" />}
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
