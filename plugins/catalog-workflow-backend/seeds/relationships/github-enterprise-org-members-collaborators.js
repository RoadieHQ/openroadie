module.exports = {
  name: 'GitHub Enterprise org member → collaborators',
  description:
    'Links GitHub Enterprise organization members to repository collaborator records with the same login.',
  sourceSeedName: 'GitHub Enterprise organization members',
  targetSeedName: 'GitHub Enterprise collaborators (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'login',
  targetFieldExpression: 'login',
  relationshipType: 'collaboratesOn',
  reciprocalRelationshipType: 'collaboratorIs',
};
