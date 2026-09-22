module.exports = {
  name: 'Humanitec application → environments',
  description:
    'Links each Humanitec application to environment records fetched from that application.',
  sourceSeedName: 'Humanitec applications (organization discovery)',
  targetSeedName: 'Humanitec environments (organization discovery)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(_parent.id) & ":" & id',
  targetFieldExpression:
    '$string(_parent._parent.id) & ":" & $string(_parent.id)',
  relationshipType: 'hasEnvironment',
  reciprocalRelationshipType: 'environmentOf',
};
