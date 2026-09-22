module.exports = {
  name: 'LaunchDarkly member → audit log',
  description:
    'Links LaunchDarkly members to audit log entries performed by the same member ID.',
  sourceSeedName: 'LaunchDarkly members',
  targetSeedName: 'LaunchDarkly audit log',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '_id',
  targetFieldExpression: '_member._id',
  relationshipType: 'performed',
  reciprocalRelationshipType: 'performedBy',
};
