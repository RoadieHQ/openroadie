module.exports = {
  name: 'Azure DevOps project → service connections',
  description:
    'Links each Azure DevOps project to service connections fetched from that project.',
  sourceSeedName: 'Azure DevOps projects',
  targetSeedName: 'Azure DevOps service connections',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(_parent.id)',
  relationshipType: 'hasServiceConnection',
  reciprocalRelationshipType: 'serviceConnectionOf',
};
