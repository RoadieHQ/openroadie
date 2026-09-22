module.exports = {
  name: 'GitHub App repo → Dependabot alerts',
  description:
    'Links each GitHub App repository to Dependabot alert records fetched from that repository.',
  sourceSeedName: 'GitHub App repositories',
  targetSeedName: 'GitHub App Dependabot alerts (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasAlert',
  reciprocalRelationshipType: 'alertFor',
};
