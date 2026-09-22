module.exports = {
  name: 'GitHub Enterprise repo → pull requests',
  description:
    'Links each GitHub Enterprise repository to pull request records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise repositories',
  targetSeedName: 'GitHub Enterprise pull requests (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasPullRequest',
  reciprocalRelationshipType: 'pullRequestOf',
};
