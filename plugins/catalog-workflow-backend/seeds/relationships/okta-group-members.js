module.exports = {
  name: 'Okta group → members',
  description:
    'Links each Okta group to the member user records fetched from that group.',
  sourceSeedName: 'Okta groups',
  targetSeedName: 'Okta group members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasMember',
  reciprocalRelationshipType: 'memberOf',
};
