import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { Checkbox } from '@roadiehq/ui/checkbox';
import { Label } from '@roadiehq/ui/label';
import { SCOPES } from '@roadiehq/scopes-common';
import type { CapabilityReferenceType } from './editor/references';
import type { ReferencingCapability } from './reference-usage';

/** Cap the rendered list so a widely-used slug doesn't produce a wall of names. */
const VISIBLE_CAPABILITIES = 8;

/**
 * The slug-narrowed scope a service token can be granted for this resource
 * type, which a rename strands. Data sources have no slug-targeted verb, so
 * they get no such warning.
 */
const PINNED_SCOPE: Partial<Record<CapabilityReferenceType, string>> = {
  capability: SCOPES.capability.get,
  action: SCOPES.action.execute,
  'context-group': SCOPES.contextGroup.query,
};

export interface RenameReferenceDialogProps {
  open: boolean;
  type: CapabilityReferenceType;
  fromSlug: string;
  toSlug: string;
  usedBy: ReferencingCapability[];
  rewrite: boolean;
  onRewriteChange: (next: boolean) => void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Confirms a slug rename that would break `@type:slug` references, offering to
 * rewrite them.
 *
 * Prose lives in `contentText`, which renders inside a `DialogDescription`
 * (a `<p>`) — so every element there is a `<span>`. The checkbox goes in
 * `children`, which renders outside the `aria-describedby` target, so a screen
 * reader doesn't announce the control as part of the description.
 */
export function RenameReferenceDialog({
  open,
  type,
  fromSlug,
  toSlug,
  usedBy,
  rewrite,
  onRewriteChange,
  onConfirm,
  onCancel,
}: RenameReferenceDialogProps) {
  const visible = usedBy.slice(0, VISIBLE_CAPABILITIES);
  const hidden = usedBy.length - visible.length;
  const pinnedScope = PINNED_SCOPE[`${type}`];

  return (
    <ConfirmationDialog
      open={open}
      title="Rename slug?"
      contentText={
        <>
          <span>
            {usedBy.length === 1
              ? '1 capability references'
              : `${usedBy.length} capabilities reference`}{' '}
            <code>
              @{type}:{fromSlug}
            </code>
            .
          </span>
          <span
            data-testid="rename-reference-warning"
            className="mt-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning"
          >
            {visible.map(capability => (
              <span key={capability.id} className="font-medium">
                {capability.name}
              </span>
            ))}
            {hidden > 0 && <span>…and {hidden} more</span>}
            <span>
              Without rewriting, {usedBy.length === 1 ? 'it' : 'they'} will be
              left with a broken reference.
            </span>
          </span>
          {pinnedScope && (
            <span className="mt-3 block text-sm text-muted-foreground">
              Service tokens scoped to{' '}
              <code>
                {pinnedScope}:{fromSlug}
              </code>{' '}
              will stop matching and must be re-issued.
            </span>
          )}
          {type === 'datasource' && (
            <span className="mt-3 block text-sm text-muted-foreground">
              Context-bundle documents are keyed by this slug, so saved
              context-group view templates addressing{' '}
              <code>members[&apos;{fromSlug}&apos;]</code> will stop matching.
            </span>
          )}
        </>
      }
      confirmButtonText="Rename"
      confirmingText="Renaming…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="flex items-start gap-2">
        <Checkbox
          id="rewrite-references"
          checked={rewrite}
          onCheckedChange={checked => onRewriteChange(checked === true)}
        />
        <div className="grid gap-1">
          <Label htmlFor="rewrite-references" className="font-normal">
            Update these capabilities to{' '}
            <code>
              @{type}:{toSlug}
            </code>
          </Label>
          <p className="text-xs text-muted-foreground">
            Each rewritten capability gets a new version.
          </p>
        </div>
      </div>
    </ConfirmationDialog>
  );
}
