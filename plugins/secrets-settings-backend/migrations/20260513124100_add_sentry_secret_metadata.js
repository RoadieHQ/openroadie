const tableName = 'secrets_metadata';

const payload = {
  display_name: 'Sentry auth token',
  internal_name: 'SENTRY_AUTH_TOKEN',
  description: 'Token for the built-in Sentry integration.',
  helpUrl: 'https://docs.sentry.io/api/auth/',
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
