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
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'incident.io follow-ups (per incident)',
  description:
    'List follow-up actions for each incident. Chains from incidents to /v2/follow_ups?incident_id=... so every follow-up carries its parent incident ID.',
  integrationSlug: 'incident',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-incidents',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v2/incidents?page_size=250',
            method: 'GET',
            arrayExpression: 'incidents',
            objectIdExpression: 'id',
            pagination: {
              type: 'cursor',
              cursorParam: 'after',
              nextCursorExpression: 'pagination_meta.after',
            },
          },
          'List incidents',
        ),
        chainedSourceNode(
          'list-follow-ups',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/v2/follow_ups?incident_id={{id}}',
            method: 'GET',
            arrayExpression: 'follow_ups',
            objectIdExpression: 'id',
            resultMode: 'flatten',
          },
          'List follow-ups per incident',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-incidents'),
        edge('e2', 'list-incidents', 'list-follow-ups'),
        edge('e3', 'list-follow-ups', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
