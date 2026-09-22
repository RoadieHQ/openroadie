module.exports = {
  name: 'GitHub repo → markdown files',
  description:
    'Links each GitHub repository to markdown file search results from that repository.',
  sourceSeedName: 'GitHub repositories',
  targetSeedName: 'GitHub markdown files',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: 'repository.full_name',
  relationshipType: 'containsFile',
  reciprocalRelationshipType: 'fileOf',
};
