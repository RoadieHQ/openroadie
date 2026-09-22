module.exports = {
  name: 'Okta user → PagerDuty user',
  description:
    'Links Okta users to PagerDuty users with the same email address.',
  sourceSeedName: 'Okta users',
  targetSeedName: 'PagerDuty users',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(profile.email)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
