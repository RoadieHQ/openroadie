module.exports = {
  name: 'Google Workspace user → Shortcut member',
  description:
    'Links Google Workspace users to Shortcut members with the same email address.',
  sourceSeedName: 'Google Workspace users',
  targetSeedName: 'Shortcut members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(primaryEmail)',
  targetFieldExpression: '$lowercase(profile.email_address)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
