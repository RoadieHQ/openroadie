module.exports = {
  name: 'Wiz project → issues',
  description:
    'Links each Wiz project to the security issues fetched from that project.',
  sourceSeedName: 'Wiz projects',
  targetSeedName: 'Wiz issues (per project)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasIssue',
  reciprocalRelationshipType: 'issueOf',
};
