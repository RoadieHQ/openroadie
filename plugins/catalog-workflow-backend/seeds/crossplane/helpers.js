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
const { K8S_LIST_PAGINATION } = require('../kubernetes/helpers');

function k8sListConfig(integrationId, path) {
  return {
    integrationId,
    path,
    method: 'GET',
    queryParams: { limit: '500' },
    arrayExpression: 'items',
    objectIdExpression: 'metadata.uid',
    pagination: K8S_LIST_PAGINATION,
  };
}

function k8sListSeed(definition) {
  return {
    name: definition.name,
    description: definition.description,
    integrationSlug: 'kubernetes',
    build(integrationId) {
      return {
        nodes: [
          scheduleTriggerNode(
            'trigger',
            { x: 0, y: 0 },
            {
              frequencyValue: definition.frequencyValue,
              frequencyUnit: 'hours',
            },
          ),
          integrationSourceNode(
            definition.listNodeId,
            { x: 280, y: 0 },
            k8sListConfig(integrationId, definition.path),
            definition.label,
          ),
          datastoreSinkNode(
            'sink',
            { x: 560, y: 0 },
            { id_selector: 'metadata.uid', items_selector: '$' },
          ),
        ],
        edges: [
          edge('e1', 'trigger', definition.listNodeId),
          edge('e2', definition.listNodeId, 'sink'),
        ],
        viewport: { x: 0, y: 0, zoom: 0.85 },
      };
    },
  };
}

function crdInstanceFilterExpression(predicate) {
  // Extract CRDs matching the predicate and augment each with its storage version for the API path template
  return `$map(
    $[${predicate}],
    function($crd) {
      $merge([$crd, {
        "storageVersion": $crd.spec.versions[storage=true].name
      }])
    }
  )`;
}

function crdInstanceSeed(definition) {
  return {
    name: definition.name,
    description: definition.description,
    integrationSlug: 'kubernetes',
    build(integrationId) {
      return {
        nodes: [
          scheduleTriggerNode(
            'trigger',
            { x: 0, y: 0 },
            {
              frequencyValue: definition.frequencyValue,
              frequencyUnit: 'hours',
            },
          ),
          integrationSourceNode(
            'list-crds',
            { x: 280, y: 0 },
            k8sListConfig(
              integrationId,
              '/apis/apiextensions.k8s.io/v1/customresourcedefinitions',
            ),
            'List CRDs',
          ),
          chainedSourceNode(
            'list-instances',
            { x: 560, y: 0 },
            {
              ...k8sListConfig(
                integrationId,
                '/apis/{{spec.group}}/{{storageVersion}}/{{spec.names.plural}}',
              ),
              resultMode: 'flatten',
            },
            definition.label,
          ),
          datastoreSinkNode(
            'sink',
            { x: 840, y: 0 },
            { id_selector: 'metadata.uid', items_selector: '$' },
          ),
        ],
        edges: [
          edge('e1', 'trigger', 'list-crds'),
          edge(
            'e2',
            'list-crds',
            'list-instances',
            crdInstanceFilterExpression(definition.predicate),
          ),
          edge('e3', 'list-instances', 'sink'),
        ],
        viewport: { x: 0, y: 0, zoom: 0.75 },
      };
    },
  };
}

module.exports = { k8sListSeed, crdInstanceSeed };
