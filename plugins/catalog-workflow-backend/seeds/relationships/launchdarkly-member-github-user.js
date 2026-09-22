module.exports = {
  name: 'LaunchDarkly member → GitHub user',
  description:
    'Links LaunchDarkly members to GitHub organization members with the same email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'LaunchDarkly members',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
