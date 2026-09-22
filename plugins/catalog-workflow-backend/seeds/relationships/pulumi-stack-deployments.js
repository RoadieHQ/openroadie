module.exports = {
  name: 'Pulumi stack → deployments',
  description:
    'Links each Pulumi stack to deployment records fetched from that stack.',
  sourceSeedName: 'Pulumi stacks (all organizations)',
  targetSeedName: 'Pulumi stack deployments (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression:
    '$string(_parent.name) & ":" & $string(projectName) & "/" & $string(stackName)',
  targetFieldExpression:
    '$string(_parent._parent.name) & ":" & $string(_parent.projectName) & "/" & $string(_parent.stackName)',
  relationshipType: 'hasDeployment',
  reciprocalRelationshipType: 'deploymentOf',
};
