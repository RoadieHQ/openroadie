module.exports = {
  name: 'GitHub org member → collaborators',
  description:
    'Links GitHub organization members to repository collaborator records with the same login.',
  sourceSeedName: 'GitHub organization members',
  targetSeedName: 'GitHub collaborators (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'login',
  targetFieldExpression: 'login',
  relationshipType: 'collaboratesOn',
  reciprocalRelationshipType: 'collaboratorIs',
};
