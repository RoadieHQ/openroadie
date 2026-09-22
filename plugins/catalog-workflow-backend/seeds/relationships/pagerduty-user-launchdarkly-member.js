module.exports = {
  name: 'PagerDuty user → LaunchDarkly member',
  description:
    'Links PagerDuty users to LaunchDarkly members with the same email address.',
  sourceSeedName: 'PagerDuty users',
  targetSeedName: 'LaunchDarkly members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
