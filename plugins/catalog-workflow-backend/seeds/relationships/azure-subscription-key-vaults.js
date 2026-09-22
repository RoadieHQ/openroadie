module.exports = {
  name: 'Azure subscription → key vaults',
  description:
    'Links each Azure subscription to key vaults fetched from that subscription.',
  sourceSeedName: 'Azure subscriptions',
  targetSeedName: 'Azure key vaults',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'subscriptionId',
  targetFieldExpression: '_parent.subscriptionId',
  relationshipType: 'containsResource',
  reciprocalRelationshipType: 'resourceIn',
};
