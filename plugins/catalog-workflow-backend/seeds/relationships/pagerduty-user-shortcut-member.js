module.exports = {
  name: 'PagerDuty user → Shortcut member',
  description:
    'Links PagerDuty users to Shortcut members with the same email address.',
  sourceSeedName: 'PagerDuty users',
  targetSeedName: 'Shortcut members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(profile.email_address)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
