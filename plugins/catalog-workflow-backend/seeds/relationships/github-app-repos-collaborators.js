module.exports = {
  name: 'GitHub App repo → collaborators',
  description:
    'Links each GitHub App repository to collaborator records fetched from that repository.',
  sourceSeedName: 'GitHub App repositories',
  targetSeedName: 'GitHub App collaborators (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasCollaborator',
  reciprocalRelationshipType: 'collaboratorOf',
};
