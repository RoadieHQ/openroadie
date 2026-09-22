module.exports = {
  name: 'GitHub repo → YAML files',
  description:
    'Links each GitHub repository to YAML file search results from that repository.',
  sourceSeedName: 'GitHub repositories',
  targetSeedName: 'GitHub YAML files',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: 'repository.full_name',
  relationshipType: 'containsFile',
  reciprocalRelationshipType: 'fileOf',
};
