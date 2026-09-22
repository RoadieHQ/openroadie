module.exports = {
  name: 'GitHub Enterprise repo → releases',
  description:
    'Links each GitHub Enterprise repository to release records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise repositories',
  targetSeedName: 'GitHub Enterprise releases (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasRelease',
  reciprocalRelationshipType: 'releaseOf',
};
