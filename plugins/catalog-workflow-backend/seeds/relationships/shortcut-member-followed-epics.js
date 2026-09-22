module.exports = {
  name: 'Shortcut member → followed epics',
  description: 'Links Shortcut members to epics they follow.',
  sourceSeedName: 'Shortcut members',
  targetSeedName: 'Shortcut epics',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'follower_ids',
  relationshipType: 'follows',
  reciprocalRelationshipType: 'followedBy',
};
