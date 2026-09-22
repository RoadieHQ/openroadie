module.exports = {
  name: 'Azure resource → virtual machines',
  description:
    'Links generic Azure resources to virtual machine typed resource records with the same ARM ID.',
  sourceSeedName: 'Azure resources',
  targetSeedName: 'Azure virtual machines',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'id',
  relationshipType: 'sameResource',
  reciprocalRelationshipType: 'sameResource',
};
