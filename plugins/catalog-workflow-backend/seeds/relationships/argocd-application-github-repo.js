module.exports = {
  name: 'Argo CD application → GitHub repository',
  description:
    'Links Argo CD applications to the GitHub repository they deploy from, matching spec.source.repoURL (with any trailing .git stripped) against the repository html_url. Only matches HTTPS github.com source URLs.',
  sourceSeedName: 'Argo CD applications',
  targetSeedName: 'GitHub repositories',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression:
    '$replace($lowercase(spec.source.repoURL), /\\.git$/, "")',
  targetFieldExpression: '$lowercase(html_url)',
  relationshipType: 'deploysFrom',
  reciprocalRelationshipType: 'deployedBy',
};
