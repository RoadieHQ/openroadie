module.exports = {
  name: 'Azure subscription → managed clusters',
  description:
    'Links each Azure subscription to managed clusters fetched from that subscription.',
  sourceSeedName: 'Azure subscriptions',
  targetSeedName: 'Azure managed clusters',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'subscriptionId',
  targetFieldExpression: '_parent.subscriptionId',
  relationshipType: 'containsResource',
  reciprocalRelationshipType: 'resourceIn',
};
