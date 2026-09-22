import { useCallback } from 'react';
import type {
  RelationshipRule,
  RelationshipRuleInput,
  RelationshipRulePreviewInput,
  RelationshipRulePreviewOptions,
  RelationshipRulePreviewResult,
} from '../../../api/datastore/datastore-client';
import { useDatastore } from '../../../api';
import { queryKeys } from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';

export function useRelationshipRuleMutations() {
  const datastoreApi = useDatastore();

  const saveMutation = useInvalidatingMutation({
    mutationFn: async ({
      input,
      existingRule,
    }: {
      input: RelationshipRuleInput;
      existingRule?: RelationshipRule | null;
    }) => {
      const rule = existingRule
        ? await datastoreApi.updateRelationshipRule(existingRule.id, input)
        : await datastoreApi.createRelationshipRule(input);
      // A suggestion has no materialized edges to refresh, and the backend
      // rejects applying one outright ("cannot be applied because it is
      // suggested") — approving is what activates it, and applies it then.
      // Without this guard every save of a suggested rule throws, which took
      // tweak-and-approve down with it: the edit persisted, the apply failed,
      // and the approve never ran.
      if (rule.state !== 'suggested') {
        await datastoreApi.applyRelationshipRule(rule.id);
      }
      return rule;
    },
    invalidates: [
      queryKeys.relationshipRules,
      queryKeys.dataSourceDetailsPrefix,
    ],
  });

  const deleteMutation = useInvalidatingMutation({
    mutationFn: (ruleId: string) => datastoreApi.deleteRelationshipRule(ruleId),
    invalidates: [
      queryKeys.relationshipRules,
      queryKeys.dataSourceDetailsPrefix,
    ],
  });

  const previewRule = useCallback(
    (
      input: RelationshipRulePreviewInput,
      options?: RelationshipRulePreviewOptions,
    ): Promise<RelationshipRulePreviewResult> =>
      datastoreApi.previewRelationshipRule(input, options),
    [datastoreApi],
  );

  // mutateAsync (stable) preserves the awaitable calling convention; callers
  // sequence follow-up work (refetch, close, navigate) and own error toasts.
  // (Rule approval lives in useRelationshipRuleTransitions, which owns the
  // approve/dismiss flow and its error toasts.)
  return {
    saveRule: saveMutation.mutateAsync,
    deleteRule: deleteMutation.mutateAsync,
    previewRule,
  };
}
