module.exports = {
  name: 'GCP folder → projects',
  description:
    'Links each GCP folder to the projects parented directly under it.',
  sourceSeedName: 'GCP folders',
  targetSeedName: 'GCP projects',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'name',
  targetFieldExpression: 'parent',
  relationshipType: 'containsProject',
  reciprocalRelationshipType: 'projectIn',
};
