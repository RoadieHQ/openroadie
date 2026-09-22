module.exports = {
  name: 'GitHub App repo → YAML files',
  description:
    'Links each GitHub App repository to YAML file search results from that repository.',
  sourceSeedName: 'GitHub App repositories',
  targetSeedName: 'GitHub App YAML files (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'containsFile',
  reciprocalRelationshipType: 'fileOf',
};
