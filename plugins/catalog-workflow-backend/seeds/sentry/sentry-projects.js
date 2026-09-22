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
  name: 'Sentry projects (all organizations)',
  description:
    'List projects across all Sentry organizations by chaining organization discovery to per-organization projects.',
  integrationSlug: 'sentry',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-organizations',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/0/organizations/',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'slug',
            pagination: {
              type: 'link',
              perPageParam: 'per_page',
              perPage: 100,
              nextLinkCondition: { param: 'results', equals: 'true' },
            },
          },
          'List organizations',
        ),
        chainedSourceNode(
          'list-projects',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/0/organizations/{{slug}}/projects/',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'link',
              perPageParam: 'per_page',
              perPage: 100,
              nextLinkCondition: { param: 'results', equals: 'true' },
            },
          },
          'List projects per org',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-projects'),
        edge('e3', 'list-projects', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
