module.exports = {
  name: 'GCP organization → folders',
  description:
    'Links each GCP organization to the folders whose parent is that organization.',
  sourceSeedName: 'GCP organizations',
  targetSeedName: 'GCP folders',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'name',
  targetFieldExpression: 'parent',
  relationshipType: 'containsFolder',
  reciprocalRelationshipType: 'folderIn',
};
