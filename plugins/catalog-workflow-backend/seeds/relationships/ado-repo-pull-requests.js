module.exports = {
  name: 'Azure DevOps repository → pull requests',
  description:
    'Links Azure DevOps repositories to pull requests created against the same repository.',
  sourceSeedName: 'Azure DevOps repositories',
  targetSeedName: 'Azure DevOps pull requests',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(repository.id)',
  relationshipType: 'hasPullRequest',
  reciprocalRelationshipType: 'pullRequestOf',
};
