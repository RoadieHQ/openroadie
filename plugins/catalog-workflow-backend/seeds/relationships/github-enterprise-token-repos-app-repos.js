module.exports = {
  name: 'GitHub Enterprise repo → GitHub Enterprise App repo',
  description:
    'Links token-discovered GitHub Enterprise repositories to GitHub Enterprise App repositories with the same full name.',
  sourceSeedName: 'GitHub Enterprise repositories',
  targetSeedName: 'GitHub Enterprise App repositories',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: 'full_name',
  relationshipType: 'sameRepository',
  reciprocalRelationshipType: 'sameRepository',
};
