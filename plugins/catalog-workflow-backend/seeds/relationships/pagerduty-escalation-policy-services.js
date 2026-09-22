module.exports = {
  name: 'PagerDuty escalation policy → services',
  description:
    'Links PagerDuty escalation policies to services using the same escalation policy ID.',
  sourceSeedName: 'PagerDuty escalation policies',
  targetSeedName: 'PagerDuty services',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'escalation_policy.id',
  relationshipType: 'governs',
  reciprocalRelationshipType: 'governedBy',
};
