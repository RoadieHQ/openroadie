module.exports = {
  name: 'Entra ID application → agent identities',
  description:
    'Links Entra ID applications to managed identity service principals with the same app ID.',
  sourceSeedName: 'Entra ID applications',
  targetSeedName: 'Entra ID agent identities',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'appId',
  targetFieldExpression: 'appId',
  relationshipType: 'hasAgentIdentity',
  reciprocalRelationshipType: 'identityFor',
};
