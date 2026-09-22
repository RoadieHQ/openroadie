module.exports = {
  name: 'GCP organization → projects',
  description:
    'Links each GCP organization to the projects parented directly under it.',
  sourceSeedName: 'GCP organizations',
  targetSeedName: 'GCP projects',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'name',
  targetFieldExpression: 'parent',
  relationshipType: 'containsProject',
  reciprocalRelationshipType: 'projectIn',
};
