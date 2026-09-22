module.exports = {
  name: 'GitHub App repo → releases',
  description:
    'Links each GitHub App repository to release records fetched from that repository.',
  sourceSeedName: 'GitHub App repositories',
  targetSeedName: 'GitHub App releases (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasRelease',
  reciprocalRelationshipType: 'releaseOf',
};
