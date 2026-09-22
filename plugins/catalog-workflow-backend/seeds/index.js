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

// A pre-built data source seed. Each seed produces one workflow row in the
// `catalog_workflows` table at plugin init, marked `created_by='system'`.
//
// Seeds are loaded by `src/seeds/seedDataSources.ts`, which resolves each
// seed's `integrationSlug` to an integration UUID via the IntegrationClient
// and inserts the row if no workflow with that name already exists.
//
// Users can edit or delete seeded data sources freely; nothing in the UI
// or API treats them as read-only.

/**
 * @typedef {object} DataSourceSeed
 * @property {string} name
 * @property {string[]} [formerNames]
 * @property {string} description
 * @property {string} integrationSlug
 * @property {(integrationId: string) => {
 *   nodes: import('@roadiehq/catalog-workflow-common').WorkflowNode[],
 *   edges: import('@roadiehq/catalog-workflow-common').WorkflowEdge[],
 *   viewport?: import('@roadiehq/catalog-workflow-common').WorkflowViewport,
 * }} build
 */

/**
 * @returns {DataSourceSeed[]}
 */
function getDataSourceSeeds() {
  const seeds = [
    ...require('./github'),
    ...require('./github-enterprise'),
    ...require('./gitlab'),
    ...require('./circleci'),
    ...require('./pagerduty'),
    ...require('./snyk'),
    ...require('./shortcut'),
    ...require('./launchdarkly'),
    ...require('./humanitec'),
    ...require('./microsoft-graph'),
    ...require('./pulumi'),
    ...require('./terraform-cloud'),
    ...require('./azure-arm'),
    ...require('./azure-devops'),
    ...require('./datadog'),
    ...require('./dynatrace'),
    ...require('./sentry'),
    ...require('./slack'),
    ...require('./incident'),
    ...require('./gcp-workspace'),
    ...require('./okta'),
    ...require('./bitbucket-cloud'),
    ...require('./bitbucket-server'),
    ...require('./anthropic'),
    ...require('./cursor'),
    ...require('./openai'),
    ...require('./gcp-resources'),
    ...require('./aws'),
    ...require('./jira'),
    ...require('./linear'),
    ...require('./sonarqube'),
    ...require('./argocd'),
    ...require('./buildkite'),
    ...require('./kubernetes'),
    ...require('./crossplane'),
    ...require('./wiz'),
  ];
  return require('./presentation').applyPresentationSelectorsToSeeds(seeds);
}

module.exports = { getDataSourceSeeds };
