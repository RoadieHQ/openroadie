module.exports = {
  name: 'Shortcut member → owned epics',
  description: 'Links Shortcut members to epics that list them as an owner.',
  sourceSeedName: 'Shortcut members',
  targetSeedName: 'Shortcut epics',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'owner_ids',
  relationshipType: 'owns',
  reciprocalRelationshipType: 'ownedBy',
};
