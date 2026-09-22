module.exports = {
  name: 'GitHub Enterprise repo → Actions workflows',
  description:
    'Links each GitHub Enterprise repository to Actions workflow records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise repositories',
  targetSeedName: 'GitHub Enterprise Actions workflows',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasWorkflow',
  reciprocalRelationshipType: 'workflowOf',
};
