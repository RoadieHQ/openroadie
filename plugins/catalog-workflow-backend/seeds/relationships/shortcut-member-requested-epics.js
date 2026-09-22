module.exports = {
  name: 'Shortcut member → requested epics',
  description: 'Links Shortcut members to epics they requested.',
  sourceSeedName: 'Shortcut members',
  targetSeedName: 'Shortcut epics',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'requested_by_id',
  relationshipType: 'requested',
  reciprocalRelationshipType: 'requestedBy',
};
