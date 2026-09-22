module.exports = {
  name: 'PagerDuty team → escalation policies',
  description:
    'Links PagerDuty teams to escalation policies associated with the same team ID.',
  sourceSeedName: 'PagerDuty teams',
  targetSeedName: 'PagerDuty escalation policies',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'teams.id',
  relationshipType: 'owns',
  reciprocalRelationshipType: 'ownedBy',
};
