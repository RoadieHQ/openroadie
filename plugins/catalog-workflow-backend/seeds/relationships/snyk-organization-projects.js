module.exports = {
  name: 'Snyk organization → projects',
  description:
    'Links each Snyk organization to project records fetched from that organization.',
  sourceSeedName: 'Snyk organizations (all organizations)',
  targetSeedName: 'Snyk projects (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasProject',
  reciprocalRelationshipType: 'projectOf',
};
