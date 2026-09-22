module.exports = {
  name: 'Shortcut member → GitHub user',
  description:
    'Links Shortcut members to GitHub organization members with the same public email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'Shortcut members',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(profile.email_address)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
