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
  name: 'GitLab group → members',
  description:
    'Links each GitLab group to the member records fetched from that group.',
  sourceSeedName: 'GitLab groups',
  targetSeedName: 'GitLab group members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(_parent.id)',
  relationshipType: 'hasMember',
  reciprocalRelationshipType: 'memberOf',
};
