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
  name: 'Bitbucket Server project → repositories',
  description:
    'Links each Bitbucket Server project to the repository records that belong to that project.',
  sourceSeedName: 'Bitbucket Server projects',
  targetSeedName: 'Bitbucket Server repositories',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'key',
  targetFieldExpression: 'project.key',
  relationshipType: 'hasRepository',
  reciprocalRelationshipType: 'repositoryOf',
};
