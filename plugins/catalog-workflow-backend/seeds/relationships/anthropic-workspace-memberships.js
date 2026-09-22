module.exports = [
  {
    name: 'Anthropic workspace → memberships',
    description:
      'Links Anthropic workspaces to their workspace membership records.',
    sourceSeedName: 'Anthropic workspaces',
    targetSeedName: 'Anthropic workspace members',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'id',
    targetFieldExpression: 'workspace_id',
    relationshipType: 'hasMembership',
    reciprocalRelationshipType: 'membershipOf',
  },
  {
    name: 'Anthropic member → workspace memberships',
    description:
      'Links Anthropic organization members to their workspace membership records.',
    sourceSeedName: 'Anthropic organization members',
    targetSeedName: 'Anthropic workspace members',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'id',
    targetFieldExpression: 'user_id',
    relationshipType: 'hasMembership',
    reciprocalRelationshipType: 'membershipOf',
  },
];
