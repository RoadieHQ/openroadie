module.exports = {
  name: 'Slack user → GitHub user',
  description:
    'Links Slack users to GitHub organization members with the same email address. Requires the users:read.email Slack scope and only matches where the GitHub user has made their email public.',
  sourceSeedName: 'Slack users',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(profile.email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
