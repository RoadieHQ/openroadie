module.exports = {
  name: 'GitHub Enterprise App repo → collaborators',
  description:
    'Links each GitHub Enterprise App repository to collaborator records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise App repositories',
  targetSeedName: 'GitHub Enterprise App collaborators (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasCollaborator',
  reciprocalRelationshipType: 'collaboratorOf',
};
