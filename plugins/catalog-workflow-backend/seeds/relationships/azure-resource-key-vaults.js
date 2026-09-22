module.exports = {
  name: 'Azure resource → key vaults',
  description:
    'Links generic Azure resources to key vault typed resource records with the same ARM ID.',
  sourceSeedName: 'Azure resources',
  targetSeedName: 'Azure key vaults',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'id',
  relationshipType: 'sameResource',
  reciprocalRelationshipType: 'sameResource',
};
