module.exports = {
  name: 'GitHub App repo → markdown files',
  description:
    'Links each GitHub App repository to markdown file search results from that repository.',
  sourceSeedName: 'GitHub App repositories',
  targetSeedName: 'GitHub App markdown files (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'containsFile',
  reciprocalRelationshipType: 'fileOf',
};
