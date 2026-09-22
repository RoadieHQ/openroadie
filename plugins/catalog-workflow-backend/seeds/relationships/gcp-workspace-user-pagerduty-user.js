module.exports = {
  name: 'Google Workspace user → PagerDuty user',
  description:
    'Links Google Workspace users to PagerDuty users with the same email address.',
  sourceSeedName: 'Google Workspace users',
  targetSeedName: 'PagerDuty users',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(primaryEmail)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
