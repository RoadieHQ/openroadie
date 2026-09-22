module.exports = {
  name: 'GitHub App repo → pull requests',
  description:
    'Links each GitHub App repository to pull request records fetched from that repository.',
  sourceSeedName: 'GitHub App repositories',
  targetSeedName: 'GitHub App pull requests (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasPullRequest',
  reciprocalRelationshipType: 'pullRequestOf',
};
