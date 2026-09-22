module.exports = {
  name: 'GitHub org member → pull requests',
  description:
    'Links GitHub organization members to pull requests authored by the same login.',
  sourceSeedName: 'GitHub organization members',
  targetSeedName: 'GitHub pull requests (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'login',
  targetFieldExpression: 'user.login',
  relationshipType: 'authored',
  reciprocalRelationshipType: 'authoredBy',
};
