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
 * GCP projects — Cloud Resource Manager v3 `projects.search`.
 * Lists every project the service account has `resourcemanager.projects.get`
 * on, regardless of where it sits in the org/folder hierarchy (unlike
 * `projects.list`, which requires a `parent` and only returns direct
 * children).
 * https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/search
 */

const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'GCP projects',
  description:
    'List every GCP project the service account can see using the Cloud Resource Manager v3 projects search endpoint.',
  integrationSlug: 'gcp-resources',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'search-projects',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v3/projects:search?pageSize=100',
            method: 'GET',
            arrayExpression: 'projects',
            objectIdExpression: 'projectId',
            pagination: {
              type: 'cursor',
              cursorParam: 'pageToken',
              nextCursorExpression: 'nextPageToken',
            },
          },
          'Search projects',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'projectId', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'search-projects'),
        edge('e2', 'search-projects', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
