module.exports = {
  name: 'Entra ID application → service principals',
  description:
    'Links Entra ID applications to service principals with the same app ID.',
  sourceSeedName: 'Entra ID applications',
  targetSeedName: 'Entra ID service principals',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'appId',
  targetFieldExpression: 'appId',
  relationshipType: 'hasServicePrincipal',
  reciprocalRelationshipType: 'servicePrincipalFor',
};
