/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const path = require('path');

const ARM_SPEC_URL =
  'https://raw.githubusercontent.com/Azure/azure-rest-api-specs/main/specification/resources/resource-manager/Microsoft.Resources/stable/2024-11-01/resources.json';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const systemUser = 'system';

  const logoPath = path.join(__dirname, 'logos', 'azure-arm.svg');
  const logoSvg = fs.readFileSync(logoPath, 'utf-8');

  await knex('integrations')
    .insert({
      id: knex.raw('gen_random_uuid()'),
      name: 'Azure Resources',
      slug: 'azure-arm',
      type: 'infrastructure',
      host: 'https://management.azure.com',
      auth_type: 'oauth2-client-credentials',
      auth_config: JSON.stringify({
        clientId: '${AZURE_CLIENT_ID}',
        clientSecret: '${AZURE_CLIENT_SECRET}',
        tokenUrl:
          'https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token',
        scope: 'https://management.azure.com/.default',
      }),
      requests_per_hour: 10000,
      requests_per_second: 2.78,
      burst_capacity: 100,
      config: JSON.stringify({}),
      logo_svg: logoSvg,
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    })
    .onConflict('slug')
    .ignore();

  const integration = await knex('integrations')
    .select('id')
    .where('slug', 'azure-arm')
    .first();

  if (!integration) {
    return;
  }

  const existingSpec = await knex('integration_spec_urls')
    .where({
      integration_id: integration.id,
      spec_url: ARM_SPEC_URL,
      spec_format: 'openapi',
    })
    .first();

  if (!existingSpec) {
    await knex('integration_spec_urls').insert({
      id: knex.raw('gen_random_uuid()'),
      integration_id: integration.id,
      spec_url: ARM_SPEC_URL,
      spec_format: 'openapi',
      created_at: now,
      updated_at: now,
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const integration = await knex('integrations')
    .select('id')
    .where('slug', 'azure-arm')
    .first();

  if (integration) {
    await knex('integration_spec_urls')
      .where('integration_id', integration.id)
      .where('spec_url', ARM_SPEC_URL)
      .del();
  }

  await knex('integrations').where('slug', 'azure-arm').del();
};
