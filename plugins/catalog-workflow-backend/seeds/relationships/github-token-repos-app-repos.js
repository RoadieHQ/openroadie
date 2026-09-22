module.exports = {
  name: 'GitHub repo → GitHub App repo',
  description:
    'Links token-discovered GitHub repositories to GitHub App repositories with the same full name.',
  sourceSeedName: 'GitHub repositories',
  targetSeedName: 'GitHub App repositories',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: 'full_name',
  relationshipType: 'sameRepository',
  reciprocalRelationshipType: 'sameRepository',
};
