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
      name: 'github',
      type: 'scm',
      host: 'https://api.github.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'token ${GITHUB_TOKEN}',
        },
      }),
      requests_per_hour: 5000,
      requests_per_second: 1.389,
      burst_capacity: 100,
      config: JSON.stringify({ apiVersion: 'v3' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'gitlab',
      type: 'scm',
      host: 'https://gitlab.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'Bearer ${GITLAB_TOKEN}',
        },
      }),
      requests_per_hour: 120000,
      requests_per_second: 33.333,
      burst_capacity: 2000,
      config: JSON.stringify({ apiVersion: 'v4' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'circleci',
      type: 'ci-cd',
      host: 'https://circleci.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          'Circle-Token': '${CIRCLECI_AUTH_TOKEN}',
        },
      }),
      requests_per_hour: 28800,
      requests_per_second: 8.0,
      burst_capacity: 50,
      config: JSON.stringify({ apiVersion: 'v2' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'pagerduty',
      type: 'incident-management',
      host: 'https://api.pagerduty.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'Token token=${PAGERDUTY_TOKEN}',
        },
      }),
      requests_per_hour: 57600,
      requests_per_second: 16.0,
      burst_capacity: 960,
      config: JSON.stringify({ apiVersion: 'v2' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'snyk',
      type: 'security',
      host: 'https://api.snyk.io',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'token ${SNYK_TOKEN}',
        },
      }),
      requests_per_hour: 97200,
      requests_per_second: 27.0,
      burst_capacity: 1620,
      config: JSON.stringify({ apiVersion: 'v1' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'buildkite',
      type: 'ci-cd',
      host: 'https://api.buildkite.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'Bearer ${BUILDKITE_TOKEN}',
        },
      }),
      requests_per_hour: 12000,
      requests_per_second: 3.333,
      burst_capacity: 200,
      config: JSON.stringify({ apiVersion: 'v2' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'launchdarkly',
      type: 'other',
      host: 'https://app.launchdarkly.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: '${LAUNCHDARKLY_API_KEY}',
        },
      }),
      requests_per_hour: 36000,
      requests_per_second: 10.0,
      burst_capacity: 100,
      config: JSON.stringify({ apiVersion: 'v2' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'bugsnag',
      type: 'monitoring',
      host: 'https://api.bugsnag.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'token ${BUGSNAG_PERSONAL_TOKEN}',
        },
      }),
      requests_per_hour: 7200,
      requests_per_second: 2.0,
      burst_capacity: 120,
      config: JSON.stringify({ apiVersion: 'v2' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'pulumi',
      type: 'infrastructure',
      host: 'https://api.pulumi.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'token ${PULUMI_ACCESS_TOKEN}',
        },
      }),
      requests_per_hour: 3600,
      requests_per_second: 1.0,
      burst_capacity: 60,
      config: JSON.stringify({ apiVersion: 'v1' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'shortcut',
      type: 'project-management',
      host: 'https://api.app.shortcut.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          'Shortcut-Token': '${SHORTCUT_ACCESS_TOKEN}',
        },
      }),
      requests_per_hour: 12000,
      requests_per_second: 3.333,
      burst_capacity: 200,
      config: JSON.stringify({ apiVersion: 'v3' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'datadog',
      type: 'monitoring',
      host: 'https://api.datadoghq.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          'DD-API-KEY': '${DD_API_TOKEN}',
          'DD-APPLICATION-KEY': '${DD_APP_TOKEN}',
        },
      }),
      requests_per_hour: 18000,
      requests_per_second: 5.0,
      burst_capacity: 300,
      config: JSON.stringify({ apiVersion: 'v1' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'sonarcloud',
      type: 'security',
      host: 'https://sonarcloud.io',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'Bearer ${SONARCLOUD_API_TOKEN}',
        },
      }),
      requests_per_hour: 18000,
      requests_per_second: 5.0,
      burst_capacity: 100,
      config: JSON.stringify({ apiVersion: 'v1' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'rootly',
      type: 'incident-management',
      host: 'https://api.rootly.com',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'Bearer ${ROOTLY_API_KEY}',
        },
      }),
      requests_per_hour: 6000,
      requests_per_second: 1.667,
      burst_capacity: 100,
      config: JSON.stringify({ apiVersion: 'v1' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'harness',
      type: 'ci-cd',
      host: 'https://app.harness.io',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          'x-api-key': '${HARNESS_API_KEY}',
        },
      }),
      requests_per_hour: 6000,
      requests_per_second: 1.667,
      burst_capacity: 100,
      config: JSON.stringify({ apiVersion: 'v1' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'humanitec',
      type: 'infrastructure',
      host: 'https://api.humanitec.io',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'Bearer ${HUMANITEC_TOKEN}',
        },
      }),
      requests_per_hour: 4800,
      requests_per_second: 1.333,
      burst_capacity: 80,
      config: JSON.stringify({ apiVersion: 'v1' }),
      created_by: systemUser,
      created_at: now,
      updated_at: now,
    },
    {
      id: knex.raw('gen_random_uuid()'),
      name: 'incident',
      type: 'incident-management',
      host: 'https://api.incident.io',
      auth_type: 'header',
      auth_config: JSON.stringify({
        headers: {
          Authorization: 'Bearer ${INCIDENT_API_KEY}',
        },
      }),
      requests_per_hour: 3600,
      requests_per_second: 1.0,
      burst_capacity: 60,
      config: JSON.stringify({ apiVersion: 'v2' }),
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
  const integrationNames = [
    'github',
    'gitlab',
    'circleci',
    'pagerduty',
    'snyk',
    'buildkite',
    'launchdarkly',
    'bugsnag',
    'pulumi',
    'shortcut',
    'datadog',
    'sonarcloud',
    'rootly',
    'harness',
    'humanitec',
    'incident',
  ];

  await knex('integrations').whereIn('name', integrationNames).del();
};
