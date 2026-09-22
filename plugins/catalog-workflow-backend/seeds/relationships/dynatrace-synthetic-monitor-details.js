module.exports = {
  name: 'Dynatrace synthetic monitor → details',
  description:
    'Links Dynatrace synthetic monitors to their detailed configuration records.',
  sourceSeedName: 'Dynatrace synthetic monitors',
  targetSeedName: 'Dynatrace synthetic monitor details',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'entityId',
  targetFieldExpression: 'entityId',
  relationshipType: 'hasDetails',
  reciprocalRelationshipType: 'detailsOf',
};
