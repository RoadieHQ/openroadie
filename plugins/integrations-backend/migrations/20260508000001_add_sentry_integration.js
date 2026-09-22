const fs = require('fs');
const path = require('path');

const LOGOS_DIR = path.resolve(__dirname, 'logos');
const SENTRY_SPEC_URL =
  'https://raw.githubusercontent.com/getsentry/sentry-api-schema/main/openapi-derefed.json';

function loadLogo(filename) {
  return fs.readFileSync(path.join(LOGOS_DIR, filename), 'utf-8');
}

async function ensureSpecUrl(knex, integrationId, now) {
  const existing = await knex('integration_spec_urls')
    .where({
      integration_id: integrationId,
      spec_url: SENTRY_SPEC_URL,
      spec_format: 'openapi',
    })
    .first();

  if (existing) {
    return;
  }

  await knex('integration_spec_urls').insert({
    id: knex.raw('gen_random_uuid()'),
    integration_id: integrationId,
    spec_url: SENTRY_SPEC_URL,
    spec_format: 'openapi',
    created_at: now,
    updated_at: now,
  });
}

exports.up = async function up(knex) {
  const now = new Date().toISOString();

  await knex('integrations')
    .insert({
      id: knex.raw('gen_random_uuid()'),
      name: 'Sentry',
      slug: 'sentry',
      type: 'monitoring',
      host: 'https://sentry.io',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'Bearer ${SENTRY_AUTH_TOKEN}',
        },
      }),
      requests_per_hour: 36000,
      requests_per_second: 10.0,
      burst_capacity: 100,
      config: JSON.stringify({ apiVersion: 'v0' }),
      backend_type: 'http',
      graphql_path: null,
      logo_svg: loadLogo('default.svg'),
      created_by: 'system',
      created_at: now,
      updated_at: now,
    })
    .onConflict('slug')
    .ignore();

  const integration = await knex('integrations')
    .select('id')
    .where('slug', 'sentry')
    .first();

  if (!integration) {
    return;
  }

  await ensureSpecUrl(knex, integration.id, now);
};

exports.down = async function down(knex) {
  const integration = await knex('integrations')
    .select('id')
    .where('slug', 'sentry')
    .first();

  if (!integration) {
    return;
  }

  await knex('integration_spec_urls')
    .where({
      integration_id: integration.id,
      spec_url: SENTRY_SPEC_URL,
      spec_format: 'openapi',
    })
    .del();

  await knex('integrations').where('id', integration.id).del();
};
