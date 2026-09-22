module.exports = {
  name: 'PagerDuty user → on-calls',
  description:
    'Links PagerDuty users to current on-call entries for the same user.',
  sourceSeedName: 'PagerDuty users',
  targetSeedName: 'PagerDuty on-calls',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'user.id',
  relationshipType: 'onCallFor',
  reciprocalRelationshipType: 'assignedTo',
};
