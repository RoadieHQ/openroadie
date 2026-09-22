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

module.exports = {
  name: 'Datadog monitor → SLOs',
  description:
    'Links Datadog monitors to the monitor-based SLOs that reference them via monitor_ids.',
  sourceSeedName: 'Datadog monitors',
  targetSeedName: 'Datadog SLOs',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'monitor_ids',
  relationshipType: 'backs',
  reciprocalRelationshipType: 'backedBy',
};
