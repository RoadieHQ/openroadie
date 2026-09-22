module.exports = {
  name: 'GitHub Enterprise App repo → YAML files',
  description:
    'Links each GitHub Enterprise App repository to YAML file search results from that repository.',
  sourceSeedName: 'GitHub Enterprise App repositories',
  targetSeedName: 'GitHub Enterprise App YAML files (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'containsFile',
  reciprocalRelationshipType: 'fileOf',
};
