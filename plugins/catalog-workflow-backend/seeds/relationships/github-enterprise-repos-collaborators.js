module.exports = {
  name: 'GitHub Enterprise repo → collaborators',
  description:
    'Links each GitHub Enterprise repository to collaborator records fetched from that repository.',
  sourceSeedName: 'GitHub Enterprise repositories',
  targetSeedName: 'GitHub Enterprise collaborators (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasCollaborator',
  reciprocalRelationshipType: 'collaboratorOf',
};
