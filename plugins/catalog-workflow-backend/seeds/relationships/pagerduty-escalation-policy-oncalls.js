module.exports = {
  name: 'PagerDuty escalation policy → on-calls',
  description:
    'Links PagerDuty escalation policies to current on-call entries for the same policy.',
  sourceSeedName: 'PagerDuty escalation policies',
  targetSeedName: 'PagerDuty on-calls',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'escalation_policy.id',
  relationshipType: 'governs',
  reciprocalRelationshipType: 'governedBy',
};
