module.exports = {
  name: 'Snyk organization → targets',
  description:
    'Links each Snyk organization to target records fetched from that organization.',
  sourceSeedName: 'Snyk organizations (all organizations)',
  targetSeedName: 'Snyk targets (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasTarget',
  reciprocalRelationshipType: 'targetOf',
};
