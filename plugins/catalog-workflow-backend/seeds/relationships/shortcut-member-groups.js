module.exports = {
  name: 'Shortcut member → groups',
  description: 'Links Shortcut members to groups that include the member ID.',
  sourceSeedName: 'Shortcut members',
  targetSeedName: 'Shortcut groups',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'member_ids',
  relationshipType: 'memberOf',
  reciprocalRelationshipType: 'hasMember',
};
