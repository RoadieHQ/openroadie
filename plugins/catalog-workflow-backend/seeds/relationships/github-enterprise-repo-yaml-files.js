module.exports = {
  name: 'GitHub Enterprise repo → YAML files',
  description:
    'Links each GitHub Enterprise repository to YAML file search results from that repository.',
  sourceSeedName: 'GitHub Enterprise repositories',
  targetSeedName: 'GitHub Enterprise YAML files',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: 'repository.full_name',
  relationshipType: 'containsFile',
  reciprocalRelationshipType: 'fileOf',
};
