module.exports = {
  name: 'GitHub Enterprise App repo → releases',
  description:
    'Links each GitHub Enterprise App repository to release records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise App repositories',
  targetSeedName: 'GitHub Enterprise App releases (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasRelease',
  reciprocalRelationshipType: 'releaseOf',
};
