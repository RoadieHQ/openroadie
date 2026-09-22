module.exports = {
  name: 'Entra ID user → GitHub user',
  description:
    'Links Entra ID users to GitHub organization members with the same email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'Entra ID users',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(mail ? mail : userPrincipalName)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
