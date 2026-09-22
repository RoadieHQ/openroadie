module.exports = {
  name: 'Entra ID domain → applications',
  description:
    'Links Entra ID domains to applications published by the same domain.',
  sourceSeedName: 'Entra ID domains',
  targetSeedName: 'Entra ID applications',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'publisherDomain',
  relationshipType: 'publishesApplication',
  reciprocalRelationshipType: 'publishedByDomain',
};
