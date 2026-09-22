module.exports = {
  name: 'PagerDuty escalation policy → incidents',
  description:
    'Links PagerDuty escalation policies to incidents using the same escalation policy ID.',
  sourceSeedName: 'PagerDuty escalation policies',
  targetSeedName: 'PagerDuty incidents',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'escalation_policy.id',
  relationshipType: 'governs',
  reciprocalRelationshipType: 'governedBy',
};
