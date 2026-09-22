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

// Plain JS so the seeds are loadable from a Knex .js migration without a
// TypeScript build step. JSDoc imports give us editor type-safety against
// the canonical workflow types in @roadiehq/catalog-workflow-common.

/** @typedef {import('@roadiehq/catalog-workflow-common').WorkflowNode} WorkflowNode */
/** @typedef {import('@roadiehq/catalog-workflow-common').WorkflowEdge} WorkflowEdge */

const NODE_TYPES = {
  TRIGGER_SCHEDULE: 'trigger-schedule',
  SOURCE_INTEGRATION: 'source-integration',
  SOURCE_CHAINED: 'source-chained',
  SINK_DATASTORE: 'sink-datastore',
};

/**
 * @param {string} id
 * @param {{ x: number, y: number }} position
 * @param {{ frequencyValue: number, frequencyUnit: 'minutes'|'hours'|'days'|'weeks', dayOfWeek?: string }} config
 * @returns {WorkflowNode}
 */
function scheduleTriggerNode(id, position, config) {
  return {
    id,
    type: NODE_TYPES.TRIGGER_SCHEDULE,
    position,
    data: { label: 'Schedule', config },
  };
}

/**
 * @param {string} id
 * @param {{ x: number, y: number }} position
 * @param {Record<string, unknown>} config
 * @param {string} [label]
 * @returns {WorkflowNode}
 */
function integrationSourceNode(
  id,
  position,
  config,
  label = 'Integration source',
) {
  return {
    id,
    type: NODE_TYPES.SOURCE_INTEGRATION,
    position,
    data: { label, config },
  };
}

/**
 * @param {string} id
 * @param {{ x: number, y: number }} position
 * @param {Record<string, unknown>} config
 * @param {string} [label]
 * @returns {WorkflowNode}
 */
function chainedSourceNode(id, position, config, label = 'Chained source') {
  return {
    id,
    type: NODE_TYPES.SOURCE_CHAINED,
    position,
    data: { label, config },
  };
}

/**
 * @param {string} id
 * @param {{ x: number, y: number }} position
 * @param {Record<string, unknown>} config
 * @param {string} [label]
 * @returns {WorkflowNode}
 */
function datastoreSinkNode(id, position, config, label = 'Datastore') {
  return {
    id,
    type: NODE_TYPES.SINK_DATASTORE,
    position,
    data: { label, config },
  };
}

/**
 * @param {string} id
 * @param {string} source
 * @param {string} target
 * @param {string} [expression] JSONata transform on the edge.
 * @returns {WorkflowEdge}
 */
function edge(id, source, target, expression) {
  const e = { id, source, target };
  if (expression) {
    e.transform = { type: 'jsonata', expression };
  }
  return e;
}

module.exports = {
  NODE_TYPES,
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
};
