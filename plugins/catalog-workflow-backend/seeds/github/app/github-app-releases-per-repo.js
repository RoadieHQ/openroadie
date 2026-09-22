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
  name: 'GitHub App releases (per repo)',
  description:
    'List releases across repositories accessible to every GitHub App installation.',
  frequencyValue: 12,
  childNodeId: 'list-releases',
  childLabel: 'List releases per repo',
  childConfig: {
    path: '/repos/{{full_name}}/releases',
    method: 'GET',
    arrayExpression: '$',
    objectIdExpression: '$string(id)',
    resultMode: 'flatten',
    pagination: PAGE_PAGINATION,
  },
  sinkIdSelector: '$string(id)',
});
