module.exports = {
  name: 'GitHub Enterprise org → members',
  description:
    'Links each GitHub Enterprise organization to the member records fetched from that organization.',
  sourceSeedName: 'GitHub Enterprise organizations',
  targetSeedName: 'GitHub Enterprise organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'login',
  targetFieldExpression: '_parent.login',
  relationshipType: 'hasMember',
  reciprocalRelationshipType: 'memberOf',
};
