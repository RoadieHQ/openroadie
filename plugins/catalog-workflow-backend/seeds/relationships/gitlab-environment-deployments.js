module.exports = {
  name: 'GitLab environment → deployments',
  description:
    'Links GitLab environments to deployments that target the same environment ID.',
  sourceSeedName: 'GitLab environments',
  targetSeedName: 'GitLab deployments',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(environment.id)',
  relationshipType: 'hasDeployment',
  reciprocalRelationshipType: 'targetsEnvironment',
};
