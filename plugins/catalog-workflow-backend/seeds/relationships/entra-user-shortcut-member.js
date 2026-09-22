module.exports = {
  name: 'Entra ID user → Shortcut member',
  description:
    'Links Entra ID users to Shortcut members with the same email address.',
  sourceSeedName: 'Entra ID users',
  targetSeedName: 'Shortcut members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(mail ? mail : userPrincipalName)',
  targetFieldExpression: '$lowercase(profile.email_address)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
