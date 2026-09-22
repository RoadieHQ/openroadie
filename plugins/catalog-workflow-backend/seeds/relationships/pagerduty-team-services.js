module.exports = {
  name: 'PagerDuty team → services',
  description:
    'Links PagerDuty teams to services associated with the same team ID.',
  sourceSeedName: 'PagerDuty teams',
  targetSeedName: 'PagerDuty services',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'teams.id',
  relationshipType: 'owns',
  reciprocalRelationshipType: 'ownedBy',
};
