module.exports = {
  name: 'GitHub Enterprise org member → releases',
  description:
    'Links GitHub Enterprise organization members to releases authored by the same login.',
  sourceSeedName: 'GitHub Enterprise organization members',
  targetSeedName: 'GitHub Enterprise releases (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'login',
  targetFieldExpression: 'author.login',
  relationshipType: 'authored',
  reciprocalRelationshipType: 'authoredBy',
};
