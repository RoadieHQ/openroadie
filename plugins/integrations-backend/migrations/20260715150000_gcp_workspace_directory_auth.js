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

// The Directory API rejects unimpersonated service accounts (my_customer has
// no meaning without a domain user), and the original scope pair covered only
// users. Live verification against a real Workspace: every other seed 403'd
// and users 400'd until the JWT carried an admin subject + per-endpoint
// scopes.

const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
  'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
  'https://www.googleapis.com/auth/admin.directory.domain.readonly',
].join(' ');

const OLD_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/cloud-identity.groups.readonly',
].join(' ');

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex('integrations')
    .where({ slug: 'gcp-workspace' })
    .update({
      auth_config: JSON.stringify({
        issuer: '${GCP_CLIENT_EMAIL}',
        privateKey: '${GCP_PRIVATE_KEY}',
        subject: '${GCP_WORKSPACE_ADMIN_EMAIL}',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope: SCOPES,
      }),
    });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex('integrations')
    .where({ slug: 'gcp-workspace' })
    .update({
      auth_config: JSON.stringify({
        issuer: '${GCP_CLIENT_EMAIL}',
        privateKey: '${GCP_PRIVATE_KEY}',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope: OLD_SCOPES,
      }),
    });
};
