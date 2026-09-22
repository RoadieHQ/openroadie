import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { useAlert, useDatastore } from '../../../api';
import {
  dismissedRelationshipRulesQuery,
  queryKeys,
} from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import { pluralS } from './suggested-rules-utils';

/** Manually dismissed suggestions, at the bottom of the suggestions panel.
 *  Dismiss is durable now, so this is the only place a changed mind can
 *  Reset (back to suggested) or Delete outright. Collapsed by default — a
 *  quiet tail, not another review wall — the toggle expands it on demand. */
export function DismissedRulesSection() {
  const datastoreApi = useDatastore();
  const alertApi = useAlert();
  const [expanded, setExpanded] = useState(false);
  const { data: dismissed = [] } = useQuery(
    dismissedRelationshipRulesQuery(datastoreApi),
  );

  const resetMutation = useInvalidatingMutation({
    mutationFn: ({
      ruleId,
      rankShown,
    }: {
      ruleId: string;
      rankShown: number;
    }) => datastoreApi.resetRelationshipRule(ruleId, { rankShown }),
    invalidates: [
      queryKeys.relationshipRules,
      queryKeys.dataSourceDetailsPrefix,
    ],
  });
  const deleteMutation = useInvalidatingMutation({
    mutationFn: (ruleId: string) => datastoreApi.deleteRelationshipRule(ruleId),
    invalidates: [queryKeys.relationshipRules],
  });

  if (dismissed.length === 0) {
    return null;
  }

  const busy = resetMutation.isPending || deleteMutation.isPending;

  return (
    <section className="space-y-2 border-t border-border pt-3">
      <Button
        type="button"
        variant="ghost"
        className="h-auto gap-2 p-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        Dismissed ({dismissed.length} suggestion{pluralS(dismissed.length)})
      </Button>
      {expanded && (
        <ul className="space-y-1">
          {dismissed.map((rule, index) => (
            <li
              key={rule.id}
              className="flex items-center gap-2 rounded border border-border/60 px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {rule.name}
              </span>
              {/* Reset re-opens the rule for review, so it's a verdict
                  transition like approve/dismiss and records its position in
                  this list. Delete below isn't a verdict — it's discarding
                  the suggestion outright — so it sends no rank. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-2xs"
                disabled={busy}
                onClick={() =>
                  resetMutation.mutate(
                    { ruleId: rule.id, rankShown: index },
                    {
                      onError: error => {
                        alertApi.post({
                          message: `Failed to reset rule: ${formatErrorString(error)}`,
                          severity: 'error',
                        });
                      },
                    },
                  )
                }
              >
                Reset
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-2xs text-destructive"
                disabled={busy}
                onClick={() =>
                  deleteMutation.mutate(rule.id, {
                    onError: error => {
                      alertApi.post({
                        message: `Failed to delete rule: ${formatErrorString(error)}`,
                        severity: 'error',
                      });
                    },
                  })
                }
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
