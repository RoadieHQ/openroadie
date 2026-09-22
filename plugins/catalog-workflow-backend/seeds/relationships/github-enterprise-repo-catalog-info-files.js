module.exports = {
  name: 'GitHub Enterprise repo → catalog-info.yaml files',
  description:
    'Links each GitHub Enterprise repository to catalog-info.yaml file search results from that repository.',
  sourceSeedName: 'GitHub Enterprise repositories',
  targetSeedName: 'GitHub Enterprise catalog-info.yaml files',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: 'repository.full_name',
  relationshipType: 'containsFile',
  reciprocalRelationshipType: 'fileOf',
};
