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

const {
  buildGithubAppPerRepoSeed,
  PAGE_PAGINATION,
} = require('./installation-repos-builder');

module.exports = buildGithubAppPerRepoSeed({
  name: 'GitHub App Dependabot alerts (per repo)',
  description:
    'List open Dependabot alerts for repositories accessible to every GitHub App installation.',
  frequencyValue: 6,
  childNodeId: 'list-alerts',
  childLabel: 'List Dependabot alerts per repo',
  childConfig: {
    path: '/repos/{{full_name}}/dependabot/alerts?state=open',
    method: 'GET',
    arrayExpression: '$',
    objectIdExpression: '$string(number)',
    resultMode: 'flatten',
    pagination: PAGE_PAGINATION,
  },
  sinkIdSelector: '$string(number)',
});
