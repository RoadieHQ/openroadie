module.exports = {
  name: 'GitHub Enterprise org → teams',
  description:
    'Links each GitHub Enterprise organization to the team records fetched from that organization.',
  sourceSeedName: 'GitHub Enterprise organizations',
  targetSeedName: 'GitHub Enterprise teams',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'login',
  targetFieldExpression: '_parent.login',
  relationshipType: 'hasTeam',
  reciprocalRelationshipType: 'teamOf',
};
