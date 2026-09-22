module.exports = {
  name: 'GitHub Enterprise App repo → Actions workflows',
  description:
    'Links each GitHub Enterprise App repository to Actions workflow records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise App repositories',
  targetSeedName: 'GitHub Enterprise App Actions workflows',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasWorkflow',
  reciprocalRelationshipType: 'workflowOf',
};
