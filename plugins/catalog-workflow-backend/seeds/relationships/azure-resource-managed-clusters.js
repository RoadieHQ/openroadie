module.exports = {
  name: 'Azure resource → managed clusters',
  description:
    'Links generic Azure resources to managed cluster typed resource records with the same ARM ID.',
  sourceSeedName: 'Azure resources',
  targetSeedName: 'Azure managed clusters',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'id',
  relationshipType: 'sameResource',
  reciprocalRelationshipType: 'sameResource',
};
