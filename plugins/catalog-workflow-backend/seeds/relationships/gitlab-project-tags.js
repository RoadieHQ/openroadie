module.exports = {
  name: 'GitLab project → tags',
  description:
    'Links each GitLab project to repository tag records fetched from that project.',
  sourceSeedName: 'GitLab projects',
  targetSeedName: 'GitLab tags',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(_parent.id)',
  relationshipType: 'hasTag',
  reciprocalRelationshipType: 'tagOf',
};
