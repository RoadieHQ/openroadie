module.exports = {
  name: 'Linear user → GitHub user',
  description:
    'Links Linear users to GitHub organization members with the same public email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'Linear users',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
