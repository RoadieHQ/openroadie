module.exports = {
  name: 'Shortcut project → epics',
  description: 'Links Shortcut projects to epics that include the project ID.',
  sourceSeedName: 'Shortcut projects',
  targetSeedName: 'Shortcut epics',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'project_ids',
  relationshipType: 'hasEpic',
  reciprocalRelationshipType: 'epicOf',
};
