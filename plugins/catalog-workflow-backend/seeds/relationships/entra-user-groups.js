module.exports = {
  name: 'Entra ID user → groups',
  description:
    'Links Entra ID users to groups listed in each user record membership IDs.',
  sourceSeedName: 'Entra ID users',
  targetSeedName: 'Entra ID groups',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'memberOfGroupIds',
  targetFieldExpression: 'id',
  relationshipType: 'memberOf',
  reciprocalRelationshipType: 'hasMember',
};
