module.exports = {
  name: 'Azure DevOps project → teams',
  description:
    'Links each Azure DevOps project to team records fetched from that project.',
  sourceSeedName: 'Azure DevOps projects',
  targetSeedName: 'Azure DevOps teams',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(_parent.id)',
  relationshipType: 'hasTeam',
  reciprocalRelationshipType: 'teamOf',
};
