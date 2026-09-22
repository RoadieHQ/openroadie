module.exports = {
  name: 'LaunchDarkly project → metrics',
  description:
    'Links each LaunchDarkly project to metric records fetched from that project.',
  sourceSeedName: 'LaunchDarkly projects',
  targetSeedName: 'LaunchDarkly metrics',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'key',
  targetFieldExpression: '_parent.key',
  relationshipType: 'hasMetric',
  reciprocalRelationshipType: 'metricOf',
};
