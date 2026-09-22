module.exports = {
  name: 'Cursor member → GitHub user',
  description:
    'Links Cursor team members to GitHub organization members with the same public email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'Cursor team members',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
