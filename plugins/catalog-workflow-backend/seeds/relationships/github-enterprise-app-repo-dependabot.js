module.exports = {
  name: 'GitHub Enterprise App repo → Dependabot alerts',
  description:
    'Links each GitHub Enterprise App repository to Dependabot alert records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise App repositories',
  targetSeedName: 'GitHub Enterprise App Dependabot alerts (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasAlert',
  reciprocalRelationshipType: 'alertFor',
};
