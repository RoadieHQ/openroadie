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

const { buildGithubAppPerRepoSeed } = require('./installation-repos-builder');

module.exports = buildGithubAppPerRepoSeed({
  name: 'GitHub App Actions workflows',
  description:
    'List Actions workflows for repositories accessible to every GitHub App installation.',
  frequencyValue: 12,
  childNodeId: 'list-workflows',
  childLabel: 'List workflows per repo',
  childConfig: {
    path: '/repos/{{full_name}}/actions/workflows',
    method: 'GET',
    arrayExpression: 'workflows',
    objectIdExpression: '$string(id)',
    resultMode: 'flatten',
  },
  sinkIdSelector: '$string(id)',
});
