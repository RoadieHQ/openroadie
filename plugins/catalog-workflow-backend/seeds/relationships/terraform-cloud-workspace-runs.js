module.exports = {
  name: 'Terraform Cloud workspace → runs',
  description:
    'Links each Terraform Cloud workspace to run records fetched from that workspace.',
  sourceSeedName: 'Terraform Cloud workspaces (all organizations)',
  targetSeedName: 'Terraform Cloud runs (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasRun',
  reciprocalRelationshipType: 'runOf',
};
