module.exports = {
  name: 'Slack user → Entra ID user',
  description:
    'Links Slack users to Entra ID users with the same email address. Requires the users:read.email Slack scope.',
  sourceSeedName: 'Slack users',
  targetSeedName: 'Entra ID users',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(profile.email)',
  targetFieldExpression: '$lowercase(mail ? mail : userPrincipalName)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
