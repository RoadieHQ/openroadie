import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';
import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import {
  constructExploreCapabilityGetTool,
  constructManageCapabilityCreateTool,
  constructExploreContextBundleGetTool,
  constructExploreContextGroupsListTool,
  constructExploreObjectGetTool,
  constructExploreRelatedObjectsGetTool,
  constructExploreSchemaGetTool,
  constructIntegrationsRequestAwsTool,
  constructIntegrationsRequestHttpTool,
  constructExploreCapabilitiesListTool,
  constructExploreCapabilitiesSearchTool,
  constructExploreDatasourcesListTool,
  constructIntegrationsListTool,
  constructExploreObjectsListTool,
  constructExploreObjectsSearchTool,
  constructManageDatasourceCreateTool,
  constructManageIntegrationCreateTool,
  constructManageRelationshipCreateTool,
  constructManageRelationshipRuleCreateTool,
  constructExploreRelationshipRulePreviewTool,
  constructExploreRelationshipRulesListTool,
  constructExploreRelationshipRuleGetTool,
  constructManageRelationshipRuleDisableTool,
  constructManageRelationshipRuleDeleteTool,
  constructManageRelationshipRuleApplyTool,
  constructExploreRelationshipRuleDryRunTool,
  constructManageRelationshipRuleApproveTool,
  constructManageRelationshipRuleDismissTool,
  constructManageRelationshipRuleResetTool,
  constructManageRelationshipRuleUpdateTool,
  constructManageRelationshipSuggestionsGenerateTool,
} from './tools';

/**
 * Builds one tool registration. Heterogeneous input/output schemas across tools
 * force the erased `ToolRegistration<any>` here, matching `McpService`'s own
 * `AnyToolRegistration`.
 */
export type ToolConstructor = (
  discovery: DiscoveryService,
  logger: LoggerService,
) => Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type erasure for heterogeneous tool constructors
  ToolRegistration<any>
>;

/**
 * The single source of truth for which tools this module registers under each
 * MCP service. `plugin.ts` registers from it, and the catalog-drift guard in
 * `packages/backend` reads tool names from it — so the admin catalog
 * (`MCP_SERVER_DEFINITIONS`) cannot silently diverge from what is registered.
 */
export const MCP_SERVICE_TOOLS: Record<string, ToolConstructor[]> = {
  // Explore: read-only catalog, capabilities, and context tools
  explore: [
    constructExploreObjectsSearchTool,
    constructExploreObjectGetTool,
    constructExploreSchemaGetTool,
    constructExploreDatasourcesListTool,
    constructExploreObjectsListTool,
    constructExploreRelatedObjectsGetTool,
    constructExploreContextBundleGetTool,
    constructExploreContextGroupsListTool,
    constructExploreCapabilitiesListTool,
    constructExploreCapabilitiesSearchTool,
    constructExploreCapabilityGetTool,
    constructExploreRelationshipRulePreviewTool,
    constructExploreRelationshipRuleDryRunTool,
    constructExploreRelationshipRulesListTool,
    constructExploreRelationshipRuleGetTool,
  ],
  // Integrations: proxied requests to external services
  integrations: [
    constructIntegrationsListTool,
    constructIntegrationsRequestHttpTool,
    constructIntegrationsRequestAwsTool,
  ],
  // Manage: write/mutation operations
  manage: [
    constructManageCapabilityCreateTool,
    constructManageDatasourceCreateTool,
    constructManageIntegrationCreateTool,
    constructManageRelationshipCreateTool,
    constructManageRelationshipRuleCreateTool,
    constructManageRelationshipRuleApplyTool,
    constructManageRelationshipRuleDisableTool,
    constructManageRelationshipRuleDeleteTool,
    constructManageRelationshipRuleApproveTool,
    constructManageRelationshipRuleDismissTool,
    constructManageRelationshipRuleResetTool,
    constructManageRelationshipRuleUpdateTool,
    constructManageRelationshipSuggestionsGenerateTool,
  ],
};

/**
 * Per-service `instructions` sent to the client at connection time (the MCP
 * `ServerOptions.instructions` slot). They orient the agent before any tool is
 * called: what the service is for, the usual order, and the tool pairs that are
 * easy to confuse. Keyed by the same service ids as `MCP_SERVICE_TOOLS`.
 */
export const MCP_SERVICE_INSTRUCTIONS: Record<string, string> = {
  explore: [
    'Read-only tools for understanding your catalog — nothing here mutates.',
    'Finding objects: explore_objects_search matches free text across all data sources; explore_object_get fetches one when you already have its datasource + object id; explore_related_objects_get walks its relationships. To browse a single data source use explore_datasources_list then explore_objects_list, and explore_schema_get for its field shape.',
    'Context bundles need a group UUID, not a slug: a context-group slug names a rule that can materialize several groups, so call explore_context_groups_list with the slug to get UUIDs, then explore_context_bundle_get with one.',
    'Relationship rules: explore_relationship_rules_list shows them, with a score and confidence band on each suggestion; explore_relationship_rule_get then returns one rule with its full evidence, and is the step to take before approving or dismissing anything. explore_relationship_rule_preview tests an unsaved rule definition; explore_relationship_rule_dry_run runs a saved rule end-to-end without writing edges (it may call integrations).',
    'Capabilities are stored playbooks for repeatable work — check for one before improvising a multi-step task. explore_capabilities_search finds them by free text (fuzzy, ranked), explore_capabilities_list enumerates them, and explore_capability_get returns the full instructions plus `referencedResources`: every `@datasource:` / `@action:` / `@context-group:` / `@capability:` token in the text, resolved to a real resource. Treat an entry with `resolved: false` as a broken step, not a naming quirk — the resource it named is gone or renamed. When you finish work no capability covered, write it up with manage_capability_create.',
  ].join('\n\n'),
  integrations: [
    'Direct authenticated requests to the external services you have configured. Call integrations_list first to see what is connected, then integrations_request_http, or integrations_request_aws for AWS SigV4-signed calls.',
    'This is the raw escape hatch. When a curated action already exists for what you need, prefer actions_execute_read / actions_execute_write instead.',
  ].join('\n\n'),
  manage: [
    'Every tool here changes state.',
    'manage_capability_create writes a capability: a playbook a later agent loads with explore_capability_get and executes. Write one after you have actually completed a piece of repeatable work, not from a plan you never ran — then replay your own text and revise what turned out to be ambiguous. Name catalog resources with `@datasource:` / `@action:` / `@context-group:` / `@capability:` tokens rather than prose, because those are what get resolved, linked, and scope-checked. Pass an existing `id` or `slug` to revise; writes are versioned, so a correcting rewrite costs nothing.',
    'manage_relationship_create links two specific objects once; manage_relationship_rule_create instead defines a rule that keeps linking matching objects across data sources — choose the rule only when you want ongoing matching. New rules are created as "suggested" for human approval unless you pass state: "active".',
    'manage_relationship_rule_apply, _disable, and _delete act on a rule that already exists. manage_relationship_rule_approve, _dismiss, and _reset move a suggested rule through review: approve applies the whole batch at once (arbitrating mirrored pairs), dismiss rejects one, and reset undoes a dismiss.',
  ].join('\n\n'),
};
