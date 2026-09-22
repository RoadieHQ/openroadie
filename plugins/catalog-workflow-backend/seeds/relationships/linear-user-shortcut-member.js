module.exports = {
  name: 'Linear user → Shortcut member',
  description:
    'Links Linear users to Shortcut members with the same email address.',
  sourceSeedName: 'Linear users',
  targetSeedName: 'Shortcut members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(profile.email_address)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
