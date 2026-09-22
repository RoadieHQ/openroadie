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

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const systemUser = 'system';

  const integrations = [
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'Azure DevOps',
      slug: 'azure-devops',
      type: 'scm',
      host: 'https://dev.azure.com',
      auth_type: 'basic',
      auth_config: JSON.stringify({
        password: '${AZURE_TOKEN}',
      }),
      requests_per_hour: 12000,
      requests_per_second: 3.333,
      burst_capacity: 200,
      config: JSON.stringify({ apiVersion: '7.0' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'Bitbucket Cloud',
      slug: 'bitbucket-cloud',
      type: 'scm',
      host: 'https://api.bitbucket.org',
      auth_type: 'basic',
      auth_config: JSON.stringify({
        username: '${BITBUCKET_USER}',
        password: '${BITBUCKET_APP_PASSWORD}',
      }),
      requests_per_hour: 36000,
      requests_per_second: 10.0,
      burst_capacity: 100,
      config: JSON.stringify({ apiVersion: '2.0' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
  ];

  await knex('integrations').insert(integrations);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const integrationNames = ['azure-devops', 'bitbucket-cloud'];

  await knex('integrations').whereIn('slug', integrationNames).del();
};
