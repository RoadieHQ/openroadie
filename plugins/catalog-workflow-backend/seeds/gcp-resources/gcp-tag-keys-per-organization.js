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
 * GCP tag keys (per organization) — chains Cloud Resource Manager v3
 * `organizations.search` into `tagKeys.list`. `tagKeys.list` takes a
 * required `parent` query param of the form `organizations/{org_id}`,
 * which is exactly the `name` field on each organization item.
 * https://docs.cloud.google.com/resource-manager/reference/rest/v3/tagKeys/list
 */

const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'GCP tag keys (per organization)',
  description:
    'List governance tag keys for each GCP organization by chaining the organizations search endpoint to tagKeys list.',
  integrationSlug: 'gcp-resources',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 24, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'search-organizations',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v3/organizations:search?pageSize=100',
            method: 'GET',
            arrayExpression: 'organizations',
            objectIdExpression: 'name',
            pagination: {
              type: 'cursor',
              cursorParam: 'pageToken',
              nextCursorExpression: 'nextPageToken',
            },
          },
          'Search organizations',
        ),
        chainedSourceNode(
          'list-tag-keys',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/v3/tagKeys?parent={{name}}&pageSize=100',
            method: 'GET',
            arrayExpression: 'tagKeys',
            objectIdExpression: 'name',
            resultMode: 'flatten',
            pagination: {
              type: 'cursor',
              cursorParam: 'pageToken',
              nextCursorExpression: 'nextPageToken',
            },
          },
          'List tag keys per org',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'name', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'search-organizations'),
        edge('e2', 'search-organizations', 'list-tag-keys'),
        edge('e3', 'list-tag-keys', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
