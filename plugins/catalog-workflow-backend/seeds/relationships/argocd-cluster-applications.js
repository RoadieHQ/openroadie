module.exports = {
  name: 'Argo CD cluster → applications',
  description:
    'Links each registered Argo CD cluster to the applications deployed to it, matching the destination API server URL.',
  sourceSeedName: 'Argo CD clusters',
  targetSeedName: 'Argo CD applications',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'server',
  targetFieldExpression: 'spec.destination.server',
  relationshipType: 'hostsApplication',
  reciprocalRelationshipType: 'deployedTo',
};
