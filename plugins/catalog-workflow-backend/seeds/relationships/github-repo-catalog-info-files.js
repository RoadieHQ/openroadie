module.exports = {
  name: 'GitHub repo → catalog-info.yaml files',
  description:
    'Links each GitHub repository to catalog-info.yaml file search results from that repository.',
  sourceSeedName: 'GitHub repositories',
  targetSeedName: 'GitHub catalog-info.yaml files',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: 'repository.full_name',
  relationshipType: 'containsFile',
  reciprocalRelationshipType: 'fileOf',
};
