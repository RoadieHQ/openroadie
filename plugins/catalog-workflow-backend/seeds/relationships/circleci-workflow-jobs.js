module.exports = {
  name: 'CircleCI workflow → jobs',
  description:
    'Links each CircleCI workflow to job records fetched from that workflow.',
  sourceSeedName: 'CircleCI workflows (all organizations)',
  targetSeedName: 'CircleCI jobs (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: '$string(_parent.id)',
  relationshipType: 'hasJob',
  reciprocalRelationshipType: 'jobOf',
};
