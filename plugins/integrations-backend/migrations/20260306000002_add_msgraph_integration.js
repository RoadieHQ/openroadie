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

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const systemUser = 'system';

  const logoPath = path.join(__dirname, 'logos', 'msgraph.svg');
  const logoSvg = fs.readFileSync(logoPath, 'utf-8');

  await knex('integrations').insert({
    id: knex.raw('gen_random_uuid()'),
    name: 'Microsoft Graph',
    slug: 'microsoft-graph',
    type: 'infrastructure',
    host: 'https://graph.microsoft.com',
    auth_type: 'oauth2-client-credentials',
    auth_config: JSON.stringify({
      clientId: '${AZURE_CLIENT_ID}',
      clientSecret: '${AZURE_CLIENT_SECRET}',
      tokenUrl:
        'https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token',
      scope: 'https://graph.microsoft.com/.default',
    }),
    requests_per_hour: 10000,
    requests_per_second: 2.78,
    burst_capacity: 100,
    config: JSON.stringify({ apiVersion: 'v1.0' }),
    logo_svg: logoSvg,
    created_by: systemUser,
    created_at: now,
    updated_at: now,
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex('integrations').where('slug', 'microsoft-graph').del();
};
