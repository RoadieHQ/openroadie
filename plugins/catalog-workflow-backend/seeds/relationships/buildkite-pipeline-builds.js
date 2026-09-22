module.exports = {
  name: 'Buildkite pipeline → builds',
  description:
    'Links each Buildkite pipeline to build records fetched from that pipeline.',
  sourceSeedName: 'Buildkite pipelines (all organizations)',
  targetSeedName: 'Buildkite builds (per pipeline)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasBuild',
  reciprocalRelationshipType: 'buildOf',
};
