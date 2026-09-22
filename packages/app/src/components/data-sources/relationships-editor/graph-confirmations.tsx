import { Checkbox } from '@roadiehq/ui/checkbox';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { Label } from '@roadiehq/ui/label';
import type { Relationship } from '../../../api/datastore/datastore-client';
import { describePendingRetypes } from './relationship-rule-inspector';
import { pluralS } from './suggested-rules-utils';
import type { ConfirmationRequest } from './use-confirmation-request';

interface GraphConfirmationsProps {
  /** Leaving the review with retypes half-applied. */
  leavingReview: {
    open: boolean;
    pendingRetypeCount: number;
    onConfirm: () => void;
    onCancel: () => void;
  };
  /** Deleting a rule that carries folded direct relationships. */
  deletingRule: {
    request: ConfirmationRequest<{ directEdges: Relationship[] }> | null;
    alsoDeleteDirect: boolean;
    onAlsoDeleteDirectChange: (value: boolean) => void;
    onConfirm: () => void;
    onCancel: () => void;
  };
  /** Clearing every generated (LLM-discovered or suggested) rule at once. */
  clearingGeneratedRules: {
    open: boolean;
    count: number;
    onConfirm: () => void;
    onCancel: () => void;
  };
  deletingDataSource: {
    /** Null when nothing is pending. */
    name: string | null;
    contentText: string | undefined;
    onConfirm: () => void;
    onCancel: () => void;
  };
  addingDataSource: {
    open: boolean;
    creating: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  };
}

/**
 * Every "are you sure" prompt the graph canvas can raise.
 *
 * Grouped because they are the same kind of thing and none of them holds state
 * — each is driven entirely by the flag and callbacks its owning hook exposes,
 * so gathering them here takes ~80 lines of JSX out of the canvas without
 * moving any decisions.
 */
export function GraphConfirmations({
  leavingReview,
  deletingRule,
  clearingGeneratedRules,
  deletingDataSource,
  addingDataSource,
}: GraphConfirmationsProps) {
  const foldedDirectCount = deletingRule.request?.payload.directEdges.length;

  return (
    <>
      <ConfirmationDialog
        open={leavingReview.open}
        title="Some direct relationships kept the previous type"
        confirmButtonText="Leave anyway"
        contentText={describePendingRetypes(
          leavingReview.pendingRetypeCount,
          'leave',
        )}
        onConfirm={leavingReview.onConfirm}
        onCancel={leavingReview.onCancel}
      />

      <ConfirmationDialog
        open={deletingRule.request !== null}
        title="Delete this relationship rule?"
        isDelete
        confirmButtonText="Delete"
        contentText={
          foldedDirectCount === undefined
            ? undefined
            : `Its materialized relationships are removed with it. This rule also has ${foldedDirectCount} direct relationship${pluralS(
                foldedDirectCount,
              )} — created by hand, they are kept unless you choose otherwise.`
        }
        onConfirm={deletingRule.onConfirm}
        onCancel={deletingRule.onCancel}
      >
        {/* In the body, not `contentText`: an interactive control inside the
            dialog's accessible description gets announced as part of it. */}
        {foldedDirectCount !== undefined && (
          <Label className="flex cursor-pointer items-center gap-2 text-foreground">
            <Checkbox
              checked={deletingRule.alsoDeleteDirect}
              onCheckedChange={checked =>
                deletingRule.onAlsoDeleteDirectChange(checked === true)
              }
            />
            Also delete the direct relationship
            {pluralS(foldedDirectCount)}
          </Label>
        )}
      </ConfirmationDialog>

      <ConfirmationDialog
        open={clearingGeneratedRules.open}
        title={`Clear ${clearingGeneratedRules.count} generated relationship${pluralS(
          clearingGeneratedRules.count,
        )}?`}
        contentText="This also removes their current relationships."
        isDelete
        confirmButtonText="Clear"
        onConfirm={clearingGeneratedRules.onConfirm}
        onCancel={clearingGeneratedRules.onCancel}
      />

      <ConfirmationDialog
        open={deletingDataSource.name !== null}
        title={`Delete ${deletingDataSource.name ?? 'this data source'}?`}
        contentText={deletingDataSource.contentText}
        isDelete
        confirmButtonText="Delete"
        onConfirm={deletingDataSource.onConfirm}
        onCancel={deletingDataSource.onCancel}
      />

      <ConfirmationDialog
        open={addingDataSource.open}
        title="Create a new data source?"
        contentText="This will create a new data source and navigate you to its configuration page."
        confirmButtonText="Create"
        confirmDisabled={addingDataSource.creating}
        onConfirm={addingDataSource.onConfirm}
        onCancel={addingDataSource.onCancel}
      />
    </>
  );
}
