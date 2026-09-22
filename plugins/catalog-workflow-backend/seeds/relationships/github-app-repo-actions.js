module.exports = {
  name: 'GitHub App repo → Actions workflows',
  description:
    'Links each GitHub App repository to Actions workflow records fetched from that repository.',
  sourceSeedName: 'GitHub App repositories',
  targetSeedName: 'GitHub App Actions workflows',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasWorkflow',
  reciprocalRelationshipType: 'workflowOf',
};
