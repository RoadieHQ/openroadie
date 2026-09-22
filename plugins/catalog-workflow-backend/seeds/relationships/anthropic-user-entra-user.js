module.exports = {
  name: 'Anthropic member → Entra ID user',
  description:
    'Links Anthropic organization members to Entra ID users with the same email address, falling back to the Entra user principal name.',
  sourceSeedName: 'Anthropic organization members',
  targetSeedName: 'Entra ID users',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(mail ? mail : userPrincipalName)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
