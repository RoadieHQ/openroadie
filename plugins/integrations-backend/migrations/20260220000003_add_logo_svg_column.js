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

const LOGOS_DIR = path.resolve(__dirname, 'logos');

const SLUG_TO_LOGO_FILE = {
  github: 'github.svg',
  gitlab: 'gitlab.svg',
  circleci: 'circleci.svg',
  pagerduty: 'pagerduty.svg',
  snyk: 'snyk.svg',
  buildkite: 'buildkite.svg',
  launchdarkly: 'launchdarkly.svg',
  bugsnag: 'bugsnag.svg',
  pulumi: 'pulumi.svg',
  shortcut: 'shortcut.svg',
  datadog: 'datadog.svg',
  sonarcloud: 'sonarcloud.svg',
  rootly: 'rootly.svg',
  harness: 'harness.svg',
  humanitec: 'humanitec.svg',
  incident: 'incident.svg',
  aws: 'aws.svg',
};

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('integrations', table => {
    table.text('logo_svg').nullable();
  });

  for (const [slug, filename] of Object.entries(SLUG_TO_LOGO_FILE)) {
    const filePath = path.join(LOGOS_DIR, filename);
    const svg = fs.readFileSync(filePath, 'utf-8');
    await knex('integrations').where('slug', slug).update({ logo_svg: svg });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('integrations', table => {
    table.dropColumn('logo_svg');
  });
};
