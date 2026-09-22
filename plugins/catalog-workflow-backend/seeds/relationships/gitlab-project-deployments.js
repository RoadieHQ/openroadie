module.exports = {
  name: 'GitLab project → deployments',
  description:
    'Links each GitLab project to deployment records fetched from that project.',
  sourceSeedName: 'GitLab projects',
  targetSeedName: 'GitLab deployments',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(_parent.id)',
  relationshipType: 'hasDeployment',
  reciprocalRelationshipType: 'deploymentOf',
};
