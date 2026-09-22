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

const DISPLAY_NAMES = new Map([
  ['github', 'GitHub'],
  ['gitlab', 'GitLab'],
  ['circleci', 'CircleCI'],
  ['pagerduty', 'PagerDuty'],
  ['snyk', 'Snyk'],
  ['buildkite', 'Buildkite'],
  ['launchdarkly', 'LaunchDarkly'],
  ['bugsnag', 'Bugsnag'],
  ['pulumi', 'Pulumi'],
  ['shortcut', 'Shortcut'],
  ['datadog', 'Datadog'],
  ['sonarcloud', 'SonarCloud'],
  ['rootly', 'Rootly'],
  ['harness', 'Harness'],
  ['humanitec', 'Humanitec'],
  ['incident', 'incident.io'],
]);

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('integrations', table => {
    table.string('slug', 255).nullable();
  });

  const rows = await knex('integrations').select('id', 'name');
  for (const row of rows) {
    const slug = row.name;
    const displayName = DISPLAY_NAMES.get(slug) ?? slug;
    await knex('integrations').where('id', row.id).update({
      slug,
      name: displayName,
    });
  }

  await knex.schema.alterTable('integrations', table => {
    table.string('slug', 255).notNullable().alter();
  });

  await knex.schema.alterTable('integrations', table => {
    table.dropUnique(['name']);
    table.unique(['slug']);
    table.dropIndex(['name'], 'idx_integrations_name');
    table.index('slug', 'idx_integrations_slug');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const rows = await knex('integrations').select('id', 'slug');
  for (const row of rows) {
    await knex('integrations').where('id', row.id).update({
      name: row.slug,
    });
  }

  await knex.schema.alterTable('integrations', table => {
    table.dropUnique(['slug']);
    table.dropIndex(['slug'], 'idx_integrations_slug');
    table.unique(['name']);
    table.index('name', 'idx_integrations_name');
  });

  await knex.schema.alterTable('integrations', table => {
    table.dropColumn('slug');
  });
};
