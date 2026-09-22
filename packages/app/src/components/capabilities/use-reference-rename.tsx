import { useCallback, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCapabilities as useCapabilitiesApi, useAlert } from '../../api';
import { queryKeys } from '../../api/queries';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../api/workspace-scope';
import { rewriteReferences } from './editor/references';
import type { CapabilityReferenceType } from './editor/references';
import { useReferenceUsage } from './use-reference-usage';
import {
  formatUsedByNames,
  type ReferencingCapability,
} from './reference-usage';
import { RenameReferenceDialog } from './rename-reference-dialog';

export interface InterceptRenameArgs {
  type: CapabilityReferenceType;
  fromSlug: string | null | undefined;
  toSlug: string;
  /**
   * Performs the slug write. Receives whether the user opted into rewriting so
   * a surface can fold a *self*-reference rewrite into its own payload — the
   * capability editor does, because a follow-up PUT would be overwritten by its
   * own stale local state.
   *
   * Must not navigate: put navigation in `onComplete`, which runs only once the
   * rewrite has settled.
   */
  commit: (opts: { rewriteReferences: boolean }) => Promise<void>;
  /** Runs after the commit and any rewrites settle. Navigation goes here. */
  onComplete?: () => void;
  /** Excluded from the rewrite PUTs — the capability whose own save handles it. */
  excludeCapabilityId?: string;
}

interface PendingRename extends InterceptRenameArgs {
  fromSlug: string;
  usedBy: ReferencingCapability[];
}

export interface UseReferenceRenameResult {
  /**
   * Call at the top of every slug-save path. Returns true when it took over —
   * the dialog is open and the caller must return immediately. Returns false
   * when the slug is unchanged or nothing references the old one, meaning the
   * caller should just save.
   */
  interceptRename(args: InterceptRenameArgs): boolean;
  /** Render once, anywhere in the subtree. */
  dialog: ReactNode;
  /**
   * True while the capability list is still loading. Disable the slug save
   * control on this, or `interceptRename` runs against stale knowledge and
   * silently reports "nothing references this".
   */
  checking: boolean;
}

/**
 * Guards a slug rename that would break `@type:slug` references in capability
 * instructions, offering to rewrite them.
 *
 * Order is rename-then-rewrite: the rename is the step that can legitimately
 * fail (a 409 on a duplicate slug), and failing it first leaves everything
 * untouched. Rewriting first would, on a failed rename, point every referencing
 * capability at a slug that does not and will not exist.
 */
export function useReferenceRename(options?: {
  skip?: boolean;
}): UseReferenceRenameResult {
  const capabilitiesApi = useCapabilitiesApi();
  const alertApi = useAlert();
  const queryClient = useQueryClient();
  const { getUsage, loading } = useReferenceUsage({ skip: options?.skip });

  const [pending, setPending] = useState<PendingRename | null>(null);
  const [rewrite, setRewrite] = useState(true);

  const interceptRename = useCallback(
    (args: InterceptRenameArgs) => {
      const { fromSlug, toSlug, type } = args;
      if (!fromSlug || !toSlug || fromSlug === toSlug) return false;
      const usedBy = getUsage(type, fromSlug);
      if (usedBy.length === 0) return false;
      setPending({ ...args, fromSlug, usedBy });
      setRewrite(true);
      return true;
    },
    [getUsage],
  );

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    const workspaceScopeKey = getWorkspaceScopeKey();
    const { type, fromSlug, toSlug, commit, onComplete, excludeCapabilityId } =
      pending;

    try {
      await commit({ rewriteReferences: rewrite });
    } catch (e: unknown) {
      // The dialog swallows rejections and only clears its own pending state,
      // so not re-throwing leaves it open for a retry. Nothing was rewritten.
      alertApi.post({
        message: `Failed to rename: ${
          e instanceof Error ? e.message : String(e)
        }`,
        severity: 'error',
      });
      return;
    }

    if (!rewrite) {
      setPending(null);
      onComplete?.();
      return;
    }

    const failed: ReferencingCapability[] = [];
    const rewritten: string[] = [];
    // Sequential, not Promise.all: each PUT bumps a version and publishes an
    // entity-change event, and N parallel writes fan that out to every client.
    for (const capability of pending.usedBy) {
      if (capability.id === excludeCapabilityId) continue;
      const next = rewriteReferences(
        capability.instructions,
        type,
        fromSlug,
        toSlug,
      );
      if (next === capability.instructions) continue;
      try {
        await capabilitiesApi.update(capability.id, { instructions: next });
        rewritten.push(capability.id);
      } catch {
        failed.push(capability);
      }
    }

    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.capabilitiesList,
        workspaceScopeKey,
      ),
    });
    for (const id of rewritten) {
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeyInScope(
          queryKeys.capabilityDetail(id),
          workspaceScopeKey,
        ),
      });
    }

    setPending(null);
    onComplete?.();

    if (failed.length > 0) {
      // The rename succeeded, so this is residue rather than a failed save —
      // the listing's broken-reference badge catches whatever is left.
      alertApi.post({
        message: `Renamed to @${type}:${toSlug}, but ${
          failed.length
        } capabilit${failed.length === 1 ? 'y' : 'ies'} still reference @${type}:${fromSlug}: ${formatUsedByNames(
          failed.map(c => c.name),
        )} — open them to fix.`,
        severity: 'error',
      });
    }
  }, [pending, rewrite, capabilitiesApi, alertApi, queryClient]);

  const handleCancel = useCallback(() => setPending(null), []);

  const dialog = pending ? (
    <RenameReferenceDialog
      open
      type={pending.type}
      fromSlug={pending.fromSlug}
      toSlug={pending.toSlug}
      usedBy={pending.usedBy}
      rewrite={rewrite}
      onRewriteChange={setRewrite}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { interceptRename, dialog, checking: loading };
}
