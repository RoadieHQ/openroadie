module.exports = {
  name: 'Snyk organization → memberships',
  description:
    'Links each Snyk organization to membership records fetched from that organization.',
  sourceSeedName: 'Snyk organizations (all organizations)',
  targetSeedName: 'Snyk memberships (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasMembership',
  reciprocalRelationshipType: 'membershipOf',
};
