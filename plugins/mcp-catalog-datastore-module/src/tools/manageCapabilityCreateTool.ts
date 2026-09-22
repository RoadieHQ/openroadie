import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import { SCOPES } from '@roadiehq/scopes';
import { SLUG_RE } from '@roadiehq/scopes-common';
import { z } from 'zod';
import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';

/** Must stay in sync with `slugify` in capabilities-backend's CapabilitiesController. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const constructManageCapabilityCreateTool = async (
  discovery: DiscoveryService,
  logger: LoggerService,
) => {
  const inputSchema = {
    id: z
      .string()
      .optional()
      .describe(
        'The id of an existing capability to revise. Pass this (or a `slug` that already exists) when refining a capability you retrieved with explore_capability_get; omit both to create a new one.',
      ),
    name: z.string().describe('The name of the capability'),
    slug: z
      .string()
      .regex(SLUG_RE)
      .optional()
      .describe(
        'Human-readable slug used to reference this capability (e.g. `deploy-service`), as in `@capability:deploy-service`. Lowercase letters, numbers and hyphens. Derived from the name when omitted. An existing slug targets that capability for revision.',
      ),
    description: z
      .string()
      .describe(
        'One or two sentences saying what the capability accomplishes and when to reach for it. This is all another agent sees in explore_capabilities_list, so it decides whether the capability ever gets opened.',
      ),
    instructions: z
      .string()
      .describe(
        'The full playbook in markdown: inputs, ordered steps naming the exact tools to call, decision points, failure modes, and expected outputs. Name catalog resources with `@type:slug` references rather than describing them in prose.',
      ),
  };

  const outputSchema = {
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  };

  const description = `<usecase>
Write a capability into the Roadie catalog: a reusable, executable playbook that any future agent — in any harness — can load with explore_capability_get and follow to completion.

A capability is not documentation about a process. It is the instructions you would need if you woke up with no memory of this session: exact tool names, exact arguments, and what to do when a step fails.

Pass \`id\` (or a \`slug\` that already exists) to revise a capability; omit both to create one. Revisions are versioned and the previous text stays recoverable, so rewriting is cheap — prefer a corrected rewrite over a vague first draft.
</usecase>

<authoring-loop>
Write capabilities from an agentic harness (Codex, Claude Code, Mistral Vibe, Cursor) rather than by hand, because a harness can *run* the steps before committing them to text. Do not skip ahead to the write:

1. **Do the task for real first.** Work the problem with actual explore_*, actions_*, and integrations_* calls until you have produced the outcome. Instructions written from a plan you never executed are guesses.
2. **Write down what worked, not what you tried.** Drop the dead ends. Keep the exact tool names, the argument shapes you passed, and the field names you read out of each result.
3. **Name resources with @-references, never prose** — see <references>. \`@action:create-repository\` is executable; "use the repo creation action" is not.
4. **Write the draft** with this tool.
5. **Verify by replay.** Call explore_capability_get on what you just wrote and inspect \`referencedResources\`: any entry with \`resolved: false\` is a broken reference — correct the slug and write again. Then re-run the procedure following only the text, ignoring what you remember from this session. Every point where you had to fall back on memory is a gap in the instructions.
6. **Revise.** Pass the same \`id\` and write the corrected text. Steps 5–6 are the loop that separates a capability that works from one that merely reads well.
</authoring-loop>

<references>
Instructions may embed \`@type:slug\` tokens that resolve to real catalog resources: \`@datasource:<slug>\`, \`@action:<slug>\`, \`@context-group:<slug>\`, \`@capability:<slug>\`. Slugs are lowercase letters, numbers and hyphens.

These are load-bearing, not formatting. explore_capability_get resolves every token and flags the unresolved ones, the UI renders them as live links, and the service-token scope picker reads them to determine which scopes a token needs in order to run this capability. A capability whose resources appear only in prose is invisible to all three — it cannot be scope-checked, and it silently rots when a data source is renamed.

Take slugs from explore_datasources_list, actions_list, explore_context_groups_list, and explore_capabilities_list. Do not guess or invent them. Reference \`@capability:<slug>\` to build on an existing capability rather than restating its steps.
</references>

<writing-the-instructions>
Markdown. What makes a capability replayable:
- **Inputs** — what the caller must supply, and how to obtain each one if it wasn't given.
- **Steps** — ordered, each naming the tool to call and the arguments to pass.
- **Decision points** — which field of a result to check, and the branch each outcome leads to.
- **Failure modes** — the errors you actually hit while doing the task, and the recovery for each.
- **Outputs** — what the caller ends up with, and how to confirm it worked.

Keep one capability to one outcome. Two loosely related procedures are two capabilities joined by an \`@capability:\` reference, not one long document.
</writing-the-instructions>

<examples>
- You just finished a multi-step investigation across three data sources: save the sequence that worked so the next on-call repeat is mechanical rather than exploratory.
- You followed a capability and found a step that was ambiguous in practice: pass its \`id\` and tighten exactly that step.
- You have a procedure spanning two systems: write one capability per system, then a third that sequences both by \`@capability:\` reference.
</examples>`;

  const createCapabilityTool: ToolRegistration<
    typeof inputSchema,
    typeof outputSchema
  > = {
    name: 'manage_capability_create',
    scope: SCOPES.capability.create,
    config: {
      title: 'Create or Update Capability',
      description,
      inputSchema,
      outputSchema,
      annotations: {
        title: 'Create or update a capability',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cb:
      context => async (params: z.output<z.ZodObject<typeof inputSchema>>) => {
        try {
          const baseUrl = await discovery.getBaseUrl('capabilities');

          // Resolve on slug: it, not the name, is what the backend enforces
          // uniqueness on.
          let existingId = params.id;
          if (!existingId) {
            const slug = params.slug ?? slugify(params.name);
            const lookup = await context.prePermissionedFetchClient(
              `${baseUrl}/${encodeURIComponent(slug)}`,
            );
            if (lookup.ok) {
              const found = await lookup.json();
              existingId = found.id;
              // 403 means the caller can create but not read, so existence is
              // unknowable here — fall through and let a 409 report the clash.
            } else if (lookup.status !== 404 && lookup.status !== 403) {
              const errorBody = await lookup.text();
              throw new Error(
                `Failed to look up capability "${slug}": ${lookup.status} ${lookup.statusText} - ${errorBody}`,
              );
            }
          }

          const isUpdate = existingId !== undefined;
          const url = isUpdate ? `${baseUrl}/${existingId}` : baseUrl;
          const method = isUpdate ? 'PATCH' : 'POST';

          const response = await context.prePermissionedFetchClient(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: params.name,
              // Only send slug when provided; on create the backend derives it
              // from the name, and on update omitting it keeps the current slug.
              ...(params.slug ? { slug: params.slug } : {}),
              description: params.description,
              instructions: params.instructions,
            }),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            const action = isUpdate ? 'update' : 'create';
            if (response.status === 409 && !isUpdate) {
              throw new Error(
                `A capability with this slug already exists, but it could not be read with the current token's scopes. Retrieve it with explore_capability_get and pass its \`id\` to revise it. (${errorBody})`,
              );
            }
            throw new Error(
              `Failed to ${action} capability: ${response.status} ${response.statusText} - ${errorBody}`,
            );
          }

          const result = await response.json();
          const action = isUpdate ? 'Updated' : 'Created';

          return {
            content: [
              {
                type: 'text',
                text: `${action} capability "${result.name}" (slug: ${result.slug}, id: ${result.id})`,
              },
            ],
            structuredContent: {
              id: result.id,
              slug: result.slug,
              name: result.name,
              description: result.description,
              createdAt: result.createdAt,
              updatedAt: result.updatedAt,
            },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Error creating/updating capability: ${message}`);
          return {
            content: [
              {
                type: 'text',
                text: `Failed to create/update capability: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  };

  return createCapabilityTool;
};
