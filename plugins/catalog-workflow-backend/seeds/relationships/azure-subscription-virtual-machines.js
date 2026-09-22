module.exports = {
  name: 'Azure subscription → virtual machines',
  description:
    'Links each Azure subscription to virtual machines fetched from that subscription.',
  sourceSeedName: 'Azure subscriptions',
  targetSeedName: 'Azure virtual machines',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'subscriptionId',
  targetFieldExpression: '_parent.subscriptionId',
  relationshipType: 'containsResource',
  reciprocalRelationshipType: 'resourceIn',
};
