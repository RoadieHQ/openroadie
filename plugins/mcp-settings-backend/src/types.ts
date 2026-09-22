export interface McpToolDefinition {
  name: string;
  description: string;
}

export interface McpServerDefinition {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  tools: McpToolDefinition[];
}

export interface McpToolSettings {
  name: string;
  description: string;
  enabled: boolean;
}

export interface McpServerSettings {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tools: McpToolSettings[];
}

export const MCP_SERVER_DEFINITIONS: McpServerDefinition[] = [
  {
    id: 'explore',
    name: 'Explore',
    description:
      'Read-only access to your context: search objects, view schemas, browse data sources, relationships, context bundles, and capabilities.',
    defaultEnabled: true,
    tools: [
      {
        name: 'explore_objects_search',
        description:
          'Full-text search across all objects in the catalog datastore.',
      },
      {
        name: 'explore_object_get',
        description: 'Fetch a specific object by datasource ID and object ID.',
      },
      {
        name: 'explore_schema_get',
        description: 'View the schema (field structure) of a datasource.',
      },
      {
        name: 'explore_datasources_list',
        description:
          'List all datasources with their descriptions and integration IDs.',
      },
      {
        name: 'explore_objects_list',
        description: 'Browse objects within a specific datasource.',
      },
      {
        name: 'explore_related_objects_get',
        description:
          'Get objects related to a specific object via relationships.',
      },
      {
        name: 'explore_context_bundle_get',
        description: 'Retrieve a context bundle with all its grouped members.',
      },
      {
        name: 'explore_context_groups_list',
        description:
          'List the context groups a context-group rule has materialized, to pick one and fetch its bundle.',
      },
      {
        name: 'explore_capabilities_list',
        description: 'List all saved capabilities.',
      },
      {
        name: 'explore_capabilities_search',
        description:
          'Search capabilities by text across their name, description and instructions.',
      },
      {
        name: 'explore_capability_get',
        description:
          'Retrieve the full instructions for a specific capability.',
      },
      {
        name: 'explore_relationship_rules_list',
        description:
          'List relationship rules with their status and layer assignments.',
      },
      {
        name: 'explore_relationship_rule_preview',
        description:
          'Preview the matches a relationship rule would produce without saving it.',
      },
      {
        name: 'explore_relationship_rule_dry_run',
        description:
          'Dry-run a saved relationship rule end-to-end without writing any relationships.',
      },
      {
        name: 'explore_relationship_rule_get',
        description:
          'Retrieve one relationship rule in full, including its scoring evidence.',
      },
    ],
  },
  {
    id: 'integrations',
    name: 'Integrations',
    description:
      'Make authenticated requests to external services through your configured integrations.',
    defaultEnabled: false,
    tools: [
      {
        name: 'integrations_list',
        description:
          'List all configured integrations and their connection details.',
      },
      {
        name: 'integrations_request_http',
        description: 'Make authenticated HTTP requests through an integration.',
      },
      {
        name: 'integrations_request_aws',
        description:
          'Make authenticated AWS API requests through an integration.',
      },
    ],
  },
  {
    id: 'manage',
    name: 'Manage',
    description:
      'Create and modify resources: capabilities, data sources, integrations, and relationships.',
    defaultEnabled: false,
    tools: [
      {
        name: 'manage_capability_create',
        description:
          'Create a reusable capability with instructions for repeatable workflows.',
      },
      {
        name: 'manage_datasource_create',
        description:
          'Create or replace the contents of a catalog datastore datasource.',
      },
      {
        name: 'manage_integration_create',
        description:
          'Create a new integration for authenticated access to an external service.',
      },
      {
        name: 'manage_relationship_create',
        description:
          'Create a direct relationship between two catalog datastore objects.',
      },
      {
        name: 'manage_relationship_rule_create',
        description:
          'Create a rule that automatically links objects across datasources.',
      },
      {
        name: 'manage_relationship_rule_apply',
        description:
          'Apply an active relationship rule and write the relationships it produces.',
      },
      {
        name: 'manage_relationship_rule_disable',
        description:
          'Disable a relationship rule so it stops producing relationships.',
      },
      {
        name: 'manage_relationship_rule_delete',
        description:
          'Delete a relationship rule and the relationships it created.',
      },
      {
        name: 'manage_relationship_rule_approve',
        description:
          'Approve suggested relationship rules, applying them and dismissing mirrored duplicates.',
      },
      {
        name: 'manage_relationship_rule_dismiss',
        description:
          'Dismiss a suggested relationship rule so later suggestion runs do not propose it again.',
      },
      {
        name: 'manage_relationship_rule_reset',
        description:
          'Return an inactive relationship rule to the suggested state for review.',
      },
      {
        name: 'manage_relationship_rule_update',
        description:
          'Update specific fields on an existing relationship rule without recreating it.',
      },
      {
        name: 'manage_relationship_suggestions_generate',
        description:
          'Generate relationship-rule suggestions across a set of datasources and persist them as suggested rules.',
      },
    ],
  },
  {
    id: 'actions',
    name: 'Actions',
    description:
      'Discover and run actions: named, parameterized HTTP operations that execute against your configured integrations.',
    defaultEnabled: false,
    tools: [
      {
        name: 'actions_list',
        description:
          'List the available actions with their input schemas and read/write mode for execution.',
      },
      {
        name: 'actions_execute_read',
        description:
          'Run a read-only action with the given inputs; refuses actions classified as write.',
      },
      {
        name: 'actions_execute_write',
        description:
          'Run a write action with the given inputs against its configured integration; refuses actions classified as read.',
      },
    ],
  },
];
