module.exports = {
  name: 'Google Workspace group → members',
  description:
    'Links each Google Workspace group to the member records fetched from that group.',
  sourceSeedName: 'Google Workspace groups',
  targetSeedName: 'Google Workspace group members (per group)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasMember',
  reciprocalRelationshipType: 'memberOf',
};
