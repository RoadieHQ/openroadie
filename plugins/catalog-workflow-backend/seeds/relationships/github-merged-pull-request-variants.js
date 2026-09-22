module.exports = [
  {
    name: 'GitHub App repo → merged pull requests',
    description:
      'Links each GitHub App repository to normalized merged pull request records fetched from that repository.',
    sourceSeedName: 'GitHub App repositories',
    targetSeedName: 'GitHub App merged pull requests (per repo)',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'full_name',
    targetFieldExpression: 'repo_full_name',
    relationshipType: 'hasMergedPullRequest',
    reciprocalRelationshipType: 'mergedPullRequestOf',
  },
  {
    name: 'GitHub Enterprise repo → merged pull requests',
    description:
      'Links each GitHub Enterprise repository to normalized merged pull request records fetched from that repository.',
    sourceSeedName: 'GitHub Enterprise repositories',
    targetSeedName: 'GitHub Enterprise merged pull requests (per repo)',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'full_name',
    targetFieldExpression: 'repo_full_name',
    relationshipType: 'hasMergedPullRequest',
    reciprocalRelationshipType: 'mergedPullRequestOf',
  },
  {
    name: 'GitHub Enterprise App repo → merged pull requests',
    description:
      'Links each GitHub Enterprise App repository to normalized merged pull request records fetched from that repository.',
    sourceSeedName: 'GitHub Enterprise App repositories',
    targetSeedName: 'GitHub Enterprise App merged pull requests (per repo)',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'full_name',
    targetFieldExpression: 'repo_full_name',
    relationshipType: 'hasMergedPullRequest',
    reciprocalRelationshipType: 'mergedPullRequestOf',
  },
];
