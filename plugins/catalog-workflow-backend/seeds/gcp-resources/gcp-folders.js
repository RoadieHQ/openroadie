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
 * GCP folders — Cloud Resource Manager v3 `folders.search`.
 * Lists every folder the service account can see, across the whole
 * resource hierarchy (no parent parameter needed, unlike `folders.list`).
 * https://docs.cloud.google.com/resource-manager/reference/rest/v3/folders/search
 */

const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'GCP folders',
  description:
    'List every GCP folder visible to the service account using the Cloud Resource Manager v3 folders search endpoint.',
  integrationSlug: 'gcp-resources',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'search-folders',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v3/folders:search?pageSize=100',
            method: 'GET',
            arrayExpression: 'folders',
            objectIdExpression: 'name',
            pagination: {
              type: 'cursor',
              cursorParam: 'pageToken',
              nextCursorExpression: 'nextPageToken',
            },
          },
          'Search folders',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'name', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'search-folders'),
        edge('e2', 'search-folders', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
