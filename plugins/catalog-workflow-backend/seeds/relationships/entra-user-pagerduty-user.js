module.exports = {
  name: 'Entra ID user → PagerDuty user',
  description:
    'Links Entra ID users to PagerDuty users with the same email address.',
  sourceSeedName: 'Entra ID users',
  targetSeedName: 'PagerDuty users',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(mail ? mail : userPrincipalName)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
