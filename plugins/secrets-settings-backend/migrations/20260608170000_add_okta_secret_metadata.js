const tableName = 'secrets_metadata';

const payload = {
  display_name: 'Okta API token',
  internal_name: 'OKTA_TOKEN',
  description: 'Token for the built-in Okta integration.',
  helpUrl: 'https://developer.okta.com/docs/guides/create-an-api-token/main/',
  is_custom: false,
};

exports.up = async function up(knex) {
  const existing = await knex(tableName)
    .where({ internal_name: payload.internal_name })
    .orWhere({ display_name: payload.display_name })
    .first();

  if (existing) {
    await knex(tableName)
      .where({ internal_name: existing.internal_name })
      .update(payload);
    return;
  }

  await knex(tableName).insert(payload);
};

exports.down = async function down(knex) {
  await knex(tableName)
    .where({ internal_name: payload.internal_name })
    .delete();
};
