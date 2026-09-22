module.exports = {
  name: 'PagerDuty user → incidents',
  description:
    'Links PagerDuty users to incidents assigned to the same user ID.',
  sourceSeedName: 'PagerDuty users',
  targetSeedName: 'PagerDuty incidents',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'assignments.assignee.id',
  relationshipType: 'assignedTo',
  reciprocalRelationshipType: 'assignedUser',
};
