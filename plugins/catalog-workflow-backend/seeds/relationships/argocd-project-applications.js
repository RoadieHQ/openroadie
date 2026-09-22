module.exports = {
  name: 'Argo CD project → applications',
  description:
    'Links each Argo CD AppProject to the applications that declare it in spec.project.',
  sourceSeedName: 'Argo CD projects',
  targetSeedName: 'Argo CD applications',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'metadata.name',
  targetFieldExpression: 'spec.project',
  relationshipType: 'owns',
  reciprocalRelationshipType: 'ownedBy',
};
