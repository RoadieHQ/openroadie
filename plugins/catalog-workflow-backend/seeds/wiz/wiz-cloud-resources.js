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

// graphEntity.properties is deliberately excluded to keep records small — it
// is a free-form JSON blob with every scanned property of the resource.
const CLOUD_RESOURCES_QUERY = `query CloudResourceSearch($filterBy: CloudResourceFilters, $first: Int, $after: String) {
  cloudResources(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
      type
      subscriptionId
      subscriptionExternalId
      graphEntity {
        id
        providerUniqueId
        name
        type
        projects {
          id
        }
        firstSeen
        lastSeen
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

module.exports = {
  name: 'Wiz cloud resources',
  description:
    'List cloud resources from the Wiz inventory graph via the GraphQL cloudResources query, with provider IDs and project membership.',
  integrationSlug: 'wiz',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-cloud-resources',
          { x: 280, y: 0 },
          {
            integrationId,
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphql: {
              query: CLOUD_RESOURCES_QUERY,
              variables: { first: 100 },
            },
            arrayExpression: 'data.cloudResources.nodes',
            objectIdExpression: 'id',
            pagination: {
              type: 'graphql-cursor',
              cursorVariable: 'after',
              nextCursorExpression: 'data.cloudResources.pageInfo.endCursor',
              hasNextPageExpression: 'data.cloudResources.pageInfo.hasNextPage',
            },
          },
          'List cloud resources',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-cloud-resources'),
        edge('e2', 'list-cloud-resources', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
