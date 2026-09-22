module.exports = {
  name: 'Entra ID domain → users',
  description:
    'Links Entra ID domains to users whose mail or user principal name belongs to the domain.',
  sourceSeedName: 'Entra ID domains',
  targetSeedName: 'Entra ID users',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(id)',
  targetFieldExpression:
    '$lowercase($split(mail ? mail : userPrincipalName, "@")[1])',
  relationshipType: 'hasUser',
  reciprocalRelationshipType: 'userOfDomain',
};
