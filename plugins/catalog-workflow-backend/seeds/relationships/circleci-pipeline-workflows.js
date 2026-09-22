module.exports = {
  name: 'CircleCI pipeline → workflows',
  description:
    'Links each CircleCI pipeline to workflow records fetched from that pipeline.',
  sourceSeedName: 'CircleCI pipelines (all organizations)',
  targetSeedName: 'CircleCI workflows (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(_parent.id)',
  relationshipType: 'hasWorkflow',
  reciprocalRelationshipType: 'workflowOf',
};
