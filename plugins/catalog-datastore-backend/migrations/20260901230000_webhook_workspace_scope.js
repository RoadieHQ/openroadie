const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  await knex.schema.alterTable('webhook_tokens', table => {
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.index('workspace_id', 'idx_webhook_tokens_workspace_id');
  });

  await knex.schema.alterTable('webhook_subscriptions', table => {
    table.dropUnique(['url'], 'webhook_subscriptions_url_unique');
    table.uuid('workspace_id').notNullable().defaultTo(DEFAULT_WORKSPACE_ID);
    table.unique(['workspace_id', 'url'], {
      indexName: 'webhook_subscriptions_workspace_url_unique',
    });
    table.index('workspace_id', 'idx_webhook_subscriptions_workspace_id');
  });
};

exports.down = async function down(knex) {
  const duplicate = await knex('webhook_subscriptions')
    .select('url')
    .count('* as count')
    .groupBy('url')
    .havingRaw('count(*) > 1')
    .first();

  if (duplicate) {
    throw new Error(
      'Cannot remove webhook workspace scope while URLs overlap between workspaces',
    );
  }

  await knex.schema.alterTable('webhook_subscriptions', table => {
    table.dropIndex('workspace_id', 'idx_webhook_subscriptions_workspace_id');
    table.dropUnique(
      ['workspace_id', 'url'],
      'webhook_subscriptions_workspace_url_unique',
    );
    table.dropColumn('workspace_id');
    table.unique(['url'], { indexName: 'webhook_subscriptions_url_unique' });
  });

  await knex.schema.alterTable('webhook_tokens', table => {
    table.dropIndex('workspace_id', 'idx_webhook_tokens_workspace_id');
    table.dropColumn('workspace_id');
  });
};
