module.exports = {
  name: 'Terraform Cloud organization → workspaces',
  description:
    'Links each Terraform Cloud organization to workspace records fetched from that organization.',
  sourceSeedName: 'Terraform Cloud organizations',
  targetSeedName: 'Terraform Cloud workspaces (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasWorkspace',
  reciprocalRelationshipType: 'workspaceOf',
};
