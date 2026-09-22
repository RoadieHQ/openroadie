module.exports = {
  name: 'GitHub Enterprise App repo → pull requests',
  description:
    'Links each GitHub Enterprise App repository to pull request records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise App repositories',
  targetSeedName: 'GitHub Enterprise App pull requests (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasPullRequest',
  reciprocalRelationshipType: 'pullRequestOf',
};
