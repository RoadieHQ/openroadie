module.exports = {
  name: 'Snyk target → projects',
  description:
    'Links each Snyk target to project records that reference that target ID.',
  sourceSeedName: 'Snyk targets (all organizations)',
  targetSeedName: 'Snyk projects (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'relationships.target.data.id',
  relationshipType: 'hasProject',
  reciprocalRelationshipType: 'projectTarget',
};
