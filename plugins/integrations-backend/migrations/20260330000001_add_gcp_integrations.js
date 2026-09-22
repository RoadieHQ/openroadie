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

const GCP_RESOURCES_SPEC_URL =
  'https://raw.githubusercontent.com/APIs-guru/openapi-directory/main/APIs/googleapis.com/cloudresourcemanager/v3/openapi.yaml';

const GCP_WORKSPACE_SPEC_URL =
  'https://raw.githubusercontent.com/APIs-guru/openapi-directory/main/APIs/googleapis.com/admin/directory_v1/openapi.yaml';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const systemUser = 'system';

  const resourcesLogoPath = path.join(__dirname, 'logos', 'gcp-resources.svg');
  const resourcesLogoSvg = fs.readFileSync(resourcesLogoPath, 'utf-8');

  const workspaceLogoPath = path.join(__dirname, 'logos', 'gcp-workspace.svg');
  const workspaceLogoSvg = fs.readFileSync(workspaceLogoPath, 'utf-8');

  await knex('integrations')
    .insert({
      id: knex.raw('gen_random_uuid()'),
      name: 'GCP Resources',
      slug: 'gcp-resources',
      type: 'infrastructure',
      host: 'https://cloudresourcemanager.googleapis.com',
      auth_type: 'oauth2-jwt-bearer',
      auth_config: JSON.stringify({
        issuer: '${GCP_SERVICE_ACCOUNT_EMAIL}',
        privateKey: '${GCP_PRIVATE_KEY}',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope: 'https://www.googleapis.com/auth/cloud-platform.read-only',
      }),
      requests_per_hour: 10000,
      requests_per_second: 2.78,
      burst_capacity: 100,
      config: JSON.stringify({}),
      logo_svg: resourcesLogoSvg,
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    })
    .onConflict('slug')
    .ignore();

  const resourcesIntegration = await knex('integrations')
    .select('id')
    .where('slug', 'gcp-resources')
    .first();

  if (resourcesIntegration) {
    const existingSpec = await knex('integration_spec_urls')
      .where({
        integration_id: resourcesIntegration.id,
        spec_url: GCP_RESOURCES_SPEC_URL,
        spec_format: 'openapi',
      })
      .first();

    if (!existingSpec) {
      await knex('integration_spec_urls').insert({
        id: knex.raw('gen_random_uuid()'),
        integration_id: resourcesIntegration.id,
        spec_url: GCP_RESOURCES_SPEC_URL,
        spec_format: 'openapi',
        created_at: now,
        updated_at: now,
      });
    }
  }

  await knex('integrations')
    .insert({
      id: knex.raw('gen_random_uuid()'),
      name: 'GCP Workspace',
      slug: 'gcp-workspace',
      type: 'infrastructure',
      host: 'https://admin.googleapis.com',
      auth_type: 'oauth2-jwt-bearer',
      auth_config: JSON.stringify({
        issuer: '${GCP_SERVICE_ACCOUNT_EMAIL}',
        privateKey: '${GCP_PRIVATE_KEY}',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope:
          'https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/cloud-identity.groups.readonly',
      }),
      requests_per_hour: 10000,
      requests_per_second: 2.78,
      burst_capacity: 100,
      config: JSON.stringify({}),
      logo_svg: workspaceLogoSvg,
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    })
    .onConflict('slug')
    .ignore();

  const workspaceIntegration = await knex('integrations')
    .select('id')
    .where('slug', 'gcp-workspace')
    .first();

  if (workspaceIntegration) {
    const existingSpec = await knex('integration_spec_urls')
      .where({
        integration_id: workspaceIntegration.id,
        spec_url: GCP_WORKSPACE_SPEC_URL,
        spec_format: 'openapi',
      })
      .first();

    if (!existingSpec) {
      await knex('integration_spec_urls').insert({
        id: knex.raw('gen_random_uuid()'),
        integration_id: workspaceIntegration.id,
        spec_url: GCP_WORKSPACE_SPEC_URL,
        spec_format: 'openapi',
        created_at: now,
        updated_at: now,
      });
    }
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const resourcesIntegration = await knex('integrations')
    .select('id')
    .where('slug', 'gcp-resources')
    .first();

  if (resourcesIntegration) {
    await knex('integration_spec_urls')
      .where('integration_id', resourcesIntegration.id)
      .del();
  }

  const workspaceIntegration = await knex('integrations')
    .select('id')
    .where('slug', 'gcp-workspace')
    .first();

  if (workspaceIntegration) {
    await knex('integration_spec_urls')
      .where('integration_id', workspaceIntegration.id)
      .del();
  }

  await knex('integrations').where('slug', 'gcp-resources').del();
  await knex('integrations').where('slug', 'gcp-workspace').del();
};
