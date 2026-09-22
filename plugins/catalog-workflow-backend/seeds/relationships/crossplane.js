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

module.exports = [
  {
    name: 'Crossplane XRD → compositions',
    description:
      'Links each CompositeResourceDefinition to Compositions whose compositeTypeRef kind matches the XRD kind.',
    sourceSeedName: 'Crossplane composite resource definitions',
    targetSeedName: 'Crossplane compositions',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'spec.names.kind',
    targetFieldExpression: 'spec.compositeTypeRef.kind',
    relationshipType: 'definesComposition',
    reciprocalRelationshipType: 'definedByXrd',
  },
  {
    name: 'Crossplane provider → provider revisions',
    description: 'Links each Provider to its current ProviderRevision.',
    sourceSeedName: 'Crossplane providers',
    targetSeedName: 'Crossplane provider revisions',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'status.currentRevision',
    targetFieldExpression: 'metadata.name',
    relationshipType: 'hasRevision',
    reciprocalRelationshipType: 'revisionOf',
  },
  {
    name: 'Crossplane function → function revisions',
    description: 'Links each Function to its current FunctionRevision.',
    sourceSeedName: 'Crossplane functions',
    targetSeedName: 'Crossplane function revisions',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'status.currentRevision',
    targetFieldExpression: 'metadata.name',
    relationshipType: 'hasRevision',
    reciprocalRelationshipType: 'revisionOf',
  },
  {
    name: 'Crossplane configuration → configuration revisions',
    description:
      'Links each Configuration to its current ConfigurationRevision.',
    sourceSeedName: 'Crossplane configurations',
    targetSeedName: 'Crossplane configuration revisions',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'status.currentRevision',
    targetFieldExpression: 'metadata.name',
    relationshipType: 'hasRevision',
    reciprocalRelationshipType: 'revisionOf',
  },
  {
    name: 'Crossplane composition → composition revisions',
    description:
      'Links each Composition to CompositionRevisions labeled with that Composition name.',
    sourceSeedName: 'Crossplane compositions',
    targetSeedName: 'Crossplane composition revisions',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'metadata.name',
    targetFieldExpression: 'metadata.labels.`crossplane.io/composition-name`',
    relationshipType: 'hasRevision',
    reciprocalRelationshipType: 'revisionOf',
  },
  {
    name: 'Crossplane provider → deployment runtime configs',
    description:
      'Links each Provider to the DeploymentRuntimeConfig it references.',
    sourceSeedName: 'Crossplane providers',
    targetSeedName: 'Crossplane deployment runtime configs',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'spec.runtimeConfigRef.name',
    targetFieldExpression: 'metadata.name',
    relationshipType: 'hasRuntimeConfig',
    reciprocalRelationshipType: 'runtimeConfigOf',
  },
  {
    name: 'Crossplane claim → composition',
    description:
      'Links each claim to the Composition named by spec.compositionRef.',
    sourceSeedName: 'Crossplane claims',
    targetSeedName: 'Crossplane compositions',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'spec.compositionRef.name',
    targetFieldExpression: 'metadata.name',
    relationshipType: 'usesComposition',
    reciprocalRelationshipType: 'compositionForClaim',
  },
  {
    name: 'Crossplane composite resource → composition',
    description:
      'Links each composite resource to the Composition named by spec.compositionRef.',
    sourceSeedName: 'Crossplane composite resources',
    targetSeedName: 'Crossplane compositions',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'spec.compositionRef.name',
    targetFieldExpression: 'metadata.name',
    relationshipType: 'usesComposition',
    reciprocalRelationshipType: 'compositionForComposite',
  },
  {
    name: 'Crossplane managed resource → provider config',
    description:
      'Links each managed resource to the ProviderConfig named by spec.providerConfigRef.',
    sourceSeedName: 'Crossplane managed resources',
    targetSeedName: 'Crossplane provider configs',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'spec.providerConfigRef.name',
    targetFieldExpression: 'metadata.name',
    relationshipType: 'usesProviderConfig',
    reciprocalRelationshipType: 'providerConfigOf',
  },
];
