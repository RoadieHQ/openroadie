module.exports = {
  name: 'Shortcut group → iterations',
  description: 'Links Shortcut groups to iterations that include the group ID.',
  sourceSeedName: 'Shortcut groups',
  targetSeedName: 'Shortcut iterations',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'group_ids',
  relationshipType: 'owns',
  reciprocalRelationshipType: 'ownedBy',
};
