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
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Shortcut epics',
  description:
    'List Shortcut epics and store them in the datastore. Useful for tracking high-level project progress.',
  integrationSlug: 'shortcut',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-epics',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v3/epics',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: '$string(id)',
          },
          'List epics',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-epics'),
        edge('e2', 'list-epics', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
