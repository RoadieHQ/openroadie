module.exports = {
  name: 'Entra ID user → LaunchDarkly member',
  description:
    'Links Entra ID users to LaunchDarkly members with the same email address.',
  sourceSeedName: 'Entra ID users',
  targetSeedName: 'LaunchDarkly members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(mail ? mail : userPrincipalName)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
