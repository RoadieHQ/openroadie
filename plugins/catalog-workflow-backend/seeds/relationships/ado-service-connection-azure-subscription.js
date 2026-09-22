module.exports = {
  name: 'Azure DevOps service connection → Azure subscription',
  description:
    'Links Azure DevOps service connections to Azure subscriptions referenced by subscription ID.',
  sourceSeedName: 'Azure DevOps service connections',
  targetSeedName: 'Azure subscriptions',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'data.subscriptionId',
  targetFieldExpression: 'subscriptionId',
  relationshipType: 'targetsSubscription',
  reciprocalRelationshipType: 'usedByConnection',
};
