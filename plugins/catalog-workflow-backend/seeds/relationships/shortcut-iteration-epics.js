module.exports = {
  name: 'Shortcut iteration → epics',
  description:
    'Links Shortcut iterations to epics assigned to the same iteration ID.',
  sourceSeedName: 'Shortcut iterations',
  targetSeedName: 'Shortcut epics',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(iteration_id)',
  relationshipType: 'containsEpic',
  reciprocalRelationshipType: 'epicIn',
};
