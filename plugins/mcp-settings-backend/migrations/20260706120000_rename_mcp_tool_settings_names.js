/**
 * sc-33930 phase 1: MCP tools renamed to service_noun_verb. Per-tool
 * enable/disable overrides are keyed by tool name, so carry existing rows
 * over to the new names. Clean break — no aliases for the old names.
 */
const RENAMES = [
  ['search-catalog-datastore', 'explore_objects_search'],
  ['list-catalog-datastore-objects', 'explore_objects_list'],
  ['get-catalog-datastore-object', 'explore_object_get'],
  ['get-related-catalog-datastore-objects', 'explore_related_objects_get'],
  ['list-catalog-datastore-datasources', 'explore_datasources_list'],
  ['get-catalog-datastore-schema', 'explore_schema_get'],
  ['get-context-bundle', 'explore_context_bundle_get'],
  ['list-context-groups', 'explore_context_groups_list'],
  ['list-capabilities', 'explore_capabilities_list'],
  ['search-capabilities', 'explore_capabilities_search'],
  ['get-capability', 'explore_capability_get'],
  ['list-relationship-rules', 'explore_relationship_rules_list'],
  ['preview-relationship-rule', 'explore_relationship_rule_preview'],
  ['dry-run-relationship-rule', 'explore_relationship_rule_dry_run'],
  ['list-integrations', 'integrations_list'],
  ['integration-request-http', 'integrations_request_http'],
  ['integration-request-aws', 'integrations_request_aws'],
  ['create-catalog-datastore-datasource', 'manage_datasource_create'],
  ['create-integration', 'manage_integration_create'],
  ['create-capability', 'manage_capability_create'],
  ['create-relationship', 'manage_relationship_create'],
  ['create-relationship-rule', 'manage_relationship_rule_create'],
  ['apply-relationship-rule', 'manage_relationship_rule_apply'],
  ['disable-relationship-rule', 'manage_relationship_rule_disable'],
  ['delete-relationship-rule', 'manage_relationship_rule_delete'],
  ['list-actions', 'actions_list'],
];

// The action-execution tool existed under three names over time
// (execute-action, and briefly execute-read-action / execute-write-action).
// All fold into actions_execute; a disable on any legacy row survives.
const ACTIONS_EXECUTE_LEGACY = [
  'execute-action',
  'execute-read-action',
  'execute-write-action',
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  for (const [oldName, newName] of RENAMES) {
    // fold instead of rename when a row for the new name already exists
    // (partial prior run, or settings written post-rename): a disable on
    // either row survives, and the plain rename can't hit the primary key.
    const rows = await knex('mcp_tool_settings')
      .whereIn('tool_name', [oldName, newName])
      .select('tool_name', 'enabled');
    if (rows.length === 0) continue;
    const enabled = rows.every(r => r.enabled);
    await knex('mcp_tool_settings')
      .whereIn('tool_name', [oldName, newName])
      .del();
    await knex('mcp_tool_settings').insert({ tool_name: newName, enabled });
  }

  const executeNames = [...ACTIONS_EXECUTE_LEGACY, 'actions_execute'];
  const executeRows = await knex('mcp_tool_settings')
    .whereIn('tool_name', executeNames)
    .select('enabled');
  if (executeRows.length > 0) {
    const enabled = executeRows.every(r => r.enabled);
    await knex('mcp_tool_settings').whereIn('tool_name', executeNames).del();
    await knex('mcp_tool_settings').insert({
      tool_name: 'actions_execute',
      enabled,
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex('mcp_tool_settings')
    .where({ tool_name: 'actions_execute' })
    .update({ tool_name: 'execute-action' });
  for (const [oldName, newName] of RENAMES) {
    await knex('mcp_tool_settings')
      .where({ tool_name: newName })
      .update({ tool_name: oldName });
  }
};
