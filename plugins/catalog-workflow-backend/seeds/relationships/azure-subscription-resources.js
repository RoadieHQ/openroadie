module.exports = {
  name: 'Azure subscription → resources',
  description:
    'Links each Azure subscription to generic resources fetched from that subscription.',
  sourceSeedName: 'Azure subscriptions',
  targetSeedName: 'Azure resources',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'subscriptionId',
  targetFieldExpression: '_parent.subscriptionId',
  relationshipType: 'containsResource',
  reciprocalRelationshipType: 'resourceIn',
};
