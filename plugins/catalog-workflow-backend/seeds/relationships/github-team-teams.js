module.exports = {
  name: 'GitHub team → child teams',
  description:
    'Links each GitHub team to the child team records that reference it as a parent.',
  sourceSeedName: 'GitHub teams',
  targetSeedName: 'GitHub teams',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(parent.id)',
  relationshipType: 'parentOf',
  reciprocalRelationshipType: 'childOf',
};
