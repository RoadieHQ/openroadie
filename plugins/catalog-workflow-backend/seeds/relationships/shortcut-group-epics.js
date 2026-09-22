module.exports = {
  name: 'Shortcut group → epics',
  description: 'Links Shortcut groups to epics assigned to the same group ID.',
  sourceSeedName: 'Shortcut groups',
  targetSeedName: 'Shortcut epics',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'group_id',
  relationshipType: 'owns',
  reciprocalRelationshipType: 'ownedBy',
};
