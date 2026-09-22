module.exports = {
  name: 'Azure subscription → storage accounts',
  description:
    'Links each Azure subscription to storage accounts fetched from that subscription.',
  sourceSeedName: 'Azure subscriptions',
  targetSeedName: 'Azure storage accounts',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'subscriptionId',
  targetFieldExpression: '_parent.subscriptionId',
  relationshipType: 'containsResource',
  reciprocalRelationshipType: 'resourceIn',
};
