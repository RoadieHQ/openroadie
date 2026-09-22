module.exports = {
  name: 'GitLab project → releases',
  description:
    'Links each GitLab project to release records fetched from that project.',
  sourceSeedName: 'GitLab projects',
  targetSeedName: 'GitLab releases',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(_parent.id)',
  relationshipType: 'hasRelease',
  reciprocalRelationshipType: 'releaseOf',
};
