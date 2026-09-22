module.exports = {
  name: 'Azure resource → storage accounts',
  description:
    'Links generic Azure resources to storage account typed resource records with the same ARM ID.',
  sourceSeedName: 'Azure resources',
  targetSeedName: 'Azure storage accounts',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'id',
  relationshipType: 'sameResource',
  reciprocalRelationshipType: 'sameResource',
};
