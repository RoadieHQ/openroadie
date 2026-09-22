module.exports = {
  name: 'Anthropic member → GitHub user',
  description:
    'Links Anthropic organization members to GitHub organization members with the same public email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'Anthropic organization members',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
