module.exports = {
  name: 'GitHub Enterprise repo → Dependabot alerts',
  description:
    'Links each GitHub Enterprise repository to Dependabot alert records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise repositories',
  targetSeedName: 'GitHub Enterprise Dependabot alerts (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasAlert',
  reciprocalRelationshipType: 'alertFor',
};
