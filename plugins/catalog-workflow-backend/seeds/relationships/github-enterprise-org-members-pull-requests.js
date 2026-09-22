module.exports = {
  name: 'GitHub Enterprise org member → pull requests',
  description:
    'Links GitHub Enterprise organization members to pull requests authored by the same login.',
  sourceSeedName: 'GitHub Enterprise organization members',
  targetSeedName: 'GitHub Enterprise pull requests (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'login',
  targetFieldExpression: 'user.login',
  relationshipType: 'authored',
  reciprocalRelationshipType: 'authoredBy',
};
