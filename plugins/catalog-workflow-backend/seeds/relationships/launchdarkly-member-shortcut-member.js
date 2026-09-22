module.exports = {
  name: 'LaunchDarkly member → Shortcut member',
  description:
    'Links LaunchDarkly members to Shortcut members with the same email address.',
  sourceSeedName: 'LaunchDarkly members',
  targetSeedName: 'Shortcut members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(profile.email_address)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
