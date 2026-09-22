module.exports = {
  name: 'PagerDuty team → incidents',
  description:
    'Links PagerDuty teams to incidents associated with the same team ID.',
  sourceSeedName: 'PagerDuty teams',
  targetSeedName: 'PagerDuty incidents',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'teams.id',
  relationshipType: 'owns',
  reciprocalRelationshipType: 'ownedBy',
};
