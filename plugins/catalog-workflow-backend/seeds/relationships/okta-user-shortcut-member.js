module.exports = {
  name: 'Okta user → Shortcut member',
  description:
    'Links Okta users to Shortcut members with the same email address.',
  sourceSeedName: 'Okta users',
  targetSeedName: 'Shortcut members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(profile.email)',
  targetFieldExpression: '$lowercase(profile.email_address)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
