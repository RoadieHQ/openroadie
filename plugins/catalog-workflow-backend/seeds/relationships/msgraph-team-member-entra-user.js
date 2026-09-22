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
  name: 'Microsoft Teams member → Entra ID user',
  description:
    'Links Microsoft Teams team membership records to the Entra ID user with the same directory object ID.',
  sourceSeedName: 'Microsoft Teams members (per team)',
  targetSeedName: 'Entra ID users',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(userId)',
  targetFieldExpression: '$string(id)',
  relationshipType: 'membershipHeldBy',
  reciprocalRelationshipType: 'heldMembership',
};
