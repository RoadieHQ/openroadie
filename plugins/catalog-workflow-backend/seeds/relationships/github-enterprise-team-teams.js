module.exports = {
  name: 'GitHub Enterprise team → child teams',
  description:
    'Links GitHub Enterprise teams to child teams that reference them as a parent.',
  sourceSeedName: 'GitHub Enterprise teams',
  targetSeedName: 'GitHub Enterprise teams',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(parent.id)',
  relationshipType: 'parentOf',
  reciprocalRelationshipType: 'childOf',
};
