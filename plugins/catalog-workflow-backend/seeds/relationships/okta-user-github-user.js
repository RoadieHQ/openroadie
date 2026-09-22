module.exports = {
  name: 'Okta user → GitHub user',
  description:
    'Links Okta users to GitHub organization members with the same email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'Okta users',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(profile.email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
