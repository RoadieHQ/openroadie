module.exports = {
  name: 'Google Workspace user → GitHub user',
  description:
    'Links Google Workspace users to GitHub organization members with the same email address. Only matches where the GitHub user has made their email public.',
  sourceSeedName: 'Google Workspace users',
  targetSeedName: 'GitHub organization members',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(primaryEmail)',
  targetFieldExpression: '$lowercase(email)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
