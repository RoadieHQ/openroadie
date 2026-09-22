module.exports = {
  name: 'LaunchDarkly team → members',
  description: 'Links LaunchDarkly teams to members that include the team key.',
  sourceSeedName: 'LaunchDarkly teams',
  targetSeedName: 'LaunchDarkly members',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: 'key',
  targetFieldExpression: 'teams.key',
  relationshipType: 'hasMember',
  reciprocalRelationshipType: 'memberOf',
};
