module.exports = {
  name: 'Buildkite organization → pipelines',
  description:
    'Links each Buildkite organization to pipeline records fetched from that organization.',
  sourceSeedName: 'Buildkite organizations',
  targetSeedName: 'Buildkite pipelines (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasPipeline',
  reciprocalRelationshipType: 'pipelineOf',
};
