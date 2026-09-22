module.exports = {
  name: 'PagerDuty user → GitHub user',
  description:
    'Links PagerDuty users to GitHub organization members with the same email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'PagerDuty users',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
