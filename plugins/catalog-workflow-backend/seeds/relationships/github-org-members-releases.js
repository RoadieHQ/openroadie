module.exports = {
  name: 'GitHub org member → releases',
  description:
    'Links GitHub organization members to releases authored by the same login.',
  sourceSeedName: 'GitHub organization members',
  targetSeedName: 'GitHub releases (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'login',
  targetFieldExpression: 'author.login',
  relationshipType: 'authored',
  reciprocalRelationshipType: 'authoredBy',
};
