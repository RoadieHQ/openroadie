module.exports = {
  name: 'Google Workspace group member → user',
  description:
    'Links Google Workspace group membership records to the user record with the same primary email address.',
  sourceSeedName: 'Google Workspace group members (per group)',
  targetSeedName: 'Google Workspace users',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$lowercase(email)',
  targetFieldExpression: '$lowercase(primaryEmail)',
  relationshipType: 'samePerson',
  reciprocalRelationshipType: 'samePerson',
};
