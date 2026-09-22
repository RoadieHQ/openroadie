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
  scheduleTriggerNode,
  datastoreSinkNode,
  edge,
} = require('../../builders');
const { installationReposPrefix } = require('./installation-repos-builder');

module.exports = {
  name: 'GitHub App repositories',
  description:
    'List repositories accessible to every GitHub App installation and store them in the datastore.',
  integrationSlug: 'github-app',

  build(integrationId) {
    const { nodes: repoNodes, edges: repoEdges } =
      installationReposPrefix(integrationId);

    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
        ),
        ...repoNodes,
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'full_name', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-installations'),
        ...repoEdges,
        edge('e2', 'list-repos', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
