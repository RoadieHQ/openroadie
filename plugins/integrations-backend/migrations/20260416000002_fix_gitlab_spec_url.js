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

const OLD_GITLAB_SPEC_URL =
  'https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/openapi/openapi.yaml';
const NEW_GITLAB_SPEC_URL =
  'https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/openapi/openapi_v3.yaml';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const gitlabIntegration = await knex('integrations')
    .where('slug', 'gitlab')
    .select('id')
    .first();

  if (!gitlabIntegration?.id) {
    return;
  }

  await knex('integration_spec_urls')
    .where('integration_id', gitlabIntegration.id)
    .andWhere('spec_url', OLD_GITLAB_SPEC_URL)
    .update({
      spec_url: NEW_GITLAB_SPEC_URL,
      processed_at: null,
      attempt_count: 0,
      last_error: null,
      updated_at: knex.fn.now(),
    });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const gitlabIntegration = await knex('integrations')
    .where('slug', 'gitlab')
    .select('id')
    .first();

  if (!gitlabIntegration?.id) {
    return;
  }

  await knex('integration_spec_urls')
    .where('integration_id', gitlabIntegration.id)
    .andWhere('spec_url', NEW_GITLAB_SPEC_URL)
    .update({
      spec_url: OLD_GITLAB_SPEC_URL,
      processed_at: null,
      attempt_count: 0,
      last_error: null,
      updated_at: knex.fn.now(),
    });
};
