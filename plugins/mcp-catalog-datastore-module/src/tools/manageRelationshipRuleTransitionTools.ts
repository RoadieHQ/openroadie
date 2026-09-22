import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

const singleRuleInput = {
  id: z.string().describe('The relationship rule UUID.'),
};

const singleRuleOutput = {
  id: z.string(),
  state: z.string(),
};

/**
 * Dismiss and reset differ only by verb and the state they move a rule to, and
 * both 409 when the rule is in the wrong state — one factory keeps that error
 * explanation identical across the two.
 */
function constructSingleTransitionTool(opts: {
  name: string;
  verb: 'dismiss' | 'reset';
  title: string;
  description: string;
  discovery: DiscoveryService;
  logger: LoggerService;
}): ToolRegistration<typeof singleRuleInput, typeof singleRuleOutput> {
  const { name, verb, title, description, discovery, logger } = opts;
  return {
    name,
    scope: SCOPES.relationshipRule.execute,
    config: {
      title,
      description,
      inputSchema: singleRuleInput,
      outputSchema: singleRuleOutput,
      annotations: {
        title,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    cb:
      context =>
      async (params: z.output<z.ZodObject<typeof singleRuleInput>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const response = await context.prePermissionedFetchClient(
            `${baseUrl}/relationship-rules/${encodeURIComponent(params.id)}/${verb}`,
            { method: 'POST' },
          );
          if (!response.ok) {
            const body = await response.text();
            throw new Error(
              response.status === 409
                ? `Rule is not in the state this transition expects: ${body}`
                : `${response.status} ${response.statusText} - ${body}`,
            );
          }
          const rule = (await response.json()) as { id: string; state: string };
          return {
            content: [
              {
                type: 'text' as const,
                text: `Rule ${rule.id} is now ${rule.state}.`,
              },
            ],
            structuredContent: { id: rule.id, state: rule.state },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error in ${name}: ${message}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to ${verb} rule: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };
}

export const constructManageRelationshipRuleDismissTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) =>
  constructSingleTransitionTool({
    name: 'manage_relationship_rule_dismiss',
    verb: 'dismiss',
    title: 'Dismiss a suggested relationship rule',
    description: `<usecase>
Reject a suggested relationship rule (suggested → inactive).

**This is permanent.** A dismissed rule is recorded with \`reviewReason: 'manual-dismiss'\` and future
\`manage_relationship_suggestions_generate\` runs will not re-propose it. Use
\`manage_relationship_rule_reset\` to put it back into review.

Only works on a rule in state "suggested" — dismissing anything else returns a state-mismatch error.
</usecase>`,
    discovery,
    logger,
  });

export const constructManageRelationshipRuleResetTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) =>
  constructSingleTransitionTool({
    name: 'manage_relationship_rule_reset',
    verb: 'reset',
    title: 'Return a rule to review',
    description: `<usecase>
Put an inactive relationship rule back into review (inactive → suggested).

The undo for \`manage_relationship_rule_dismiss\`, and the way to re-open a rule that was disabled.
Only works on a rule in state "inactive".
</usecase>`,
    discovery,
    logger,
  });

const approveInput = {
  ids: z
    .array(z.string())
    .min(1)
    .describe(
      'Rule UUIDs to approve. Pass every id you want approved in ONE call — the backend ' +
        'arbitrates mirrored pairs across the whole batch, which it cannot do one id at a time.',
    ),
};

const approveOutput = {
  approved: z
    .array(z.string())
    .describe('Requested ids that are now active, with their edges applied.'),
  dismissedAsInverse: z
    .array(z.string())
    .describe(
      'Mirror rules suppressed because their opposite direction was approved. Nothing to do.',
    ),
  failed: z
    .array(z.object({ id: z.string(), reason: z.string() }))
    .describe(
      'Ids YOU requested that were not approved. This is the failure count — act on each reason.',
    ),
  inverseDismissFailed: z
    .array(z.object({ id: z.string(), reason: z.string() }))
    .describe(
      'Rules you did NOT request: mirrors of an approved rule that could not be suppressed. The ' +
        'approve itself succeeded; these are still "suggested" and would materialise a duplicate ' +
        'edge if approved later. Dismiss each by hand with manage_relationship_rule_dismiss. Do ' +
        'not count these as approve failures.',
    ),
};

export const constructManageRelationshipRuleApproveTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const description = `<usecase>
Approve suggested relationship rules (suggested → active). Approving a rule **applies it
immediately** — its edges are materialised as part of the call.

**Mirrored pairs are handled for you.** Suggestion generation often proposes both A→B and B→A over
the same field pair; they produce the same edge. This tool sends the whole batch to the backend,
which dismisses the mirror of every id you approve, returning it in \`dismissedAsInverse\`. If you
request BOTH directions of a pair, score decides which one is actually approved (ties broken by id);
if you request only ONE direction, that direction wins unconditionally — even against a
higher-scoring mirror you didn't ask for — because naming a direction is a deliberate choice, not a
default the backend should override. That arbitration needs the full set, so batch your ids into one
call rather than calling once per rule.

**Reading the result.** \`failed\` carries only ids YOU asked for — that is your failure count. An id
whose approve was skipped because its opposite direction was not approved appears there with a
reason starting "Left suggested:". \`inverseDismissFailed\` is different: those are mirrors you never
requested that the backend could not suppress. Your approve worked; a redundant suggestion is simply
still sitting there and should be cleared with \`manage_relationship_rule_dismiss\`. Never fold it
into the failure count.

**Recommended workflow:**
1. explore_relationship_rules_list — triage on score + band.
2. explore_relationship_rule_get / explore_relationship_rule_dry_run — verify the ones you doubt.
3. manage_relationship_rule_approve (this tool) — approve the keepers in one call.
4. manage_relationship_rule_dismiss — reject the rest.
</usecase>`;

  const tool: ToolRegistration<typeof approveInput, typeof approveOutput> = {
    name: 'manage_relationship_rule_approve',
    scope: SCOPES.relationshipRule.execute,
    config: {
      title: 'Approve suggested relationship rules',
      description,
      inputSchema: approveInput,
      outputSchema: approveOutput,
      annotations: {
        title: 'Approve suggested relationship rules',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof approveInput>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('catalog-datastore');
          const response = await context.prePermissionedFetchClient(
            `${baseUrl}/relationship-rules/approve`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: params.ids }),
            },
          );
          if (!response.ok) {
            const body = await response.text();
            throw new Error(
              `${response.status} ${response.statusText} - ${body}`,
            );
          }
          const result = (await response.json()) as {
            approved: string[];
            dismissedAsInverse: string[];
            failed: Array<{ id: string; reason: string }>;
            // Added after this tool shipped; an older backend omits it.
            inverseDismissFailed?: Array<{ id: string; reason: string }>;
          };
          const inverseDismissFailed = result.inverseDismissFailed ?? [];
          const lines = (entries: Array<{ id: string; reason: string }>) =>
            entries.map(f => `  - ${f.id}: ${f.reason}`).join('\n');
          const failedLines = lines(result.failed);
          const inverseLines = lines(inverseDismissFailed);
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `${result.approved.length} rule(s) approved and applied; ` +
                  `${result.dismissedAsInverse.length} dismissed as the inverse direction.` +
                  (failedLines ? `\nCould not approve:\n${failedLines}` : '') +
                  // Kept separate from "could not approve": these are unrequested
                  // mirrors, so reporting them as failures would tell the agent its
                  // approve broke when it worked.
                  (inverseLines
                    ? `\nApproved, but a redundant mirror could not be dismissed and is still suggested — ` +
                      `dismiss it with manage_relationship_rule_dismiss:\n${inverseLines}`
                    : ''),
              },
            ],
            structuredContent: { ...result, inverseDismissFailed },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error approving relationship rules: ${message}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to approve rules: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return tool;
};
