module.exports = {
  name: 'GCP organization → tag keys',
  description:
    'Links each GCP organization to tag key records fetched from that organization.',
  sourceSeedName: 'GCP organizations',
  targetSeedName: 'GCP tag keys (per organization)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'name',
  targetFieldExpression: '_parent.name',
  relationshipType: 'hasTagKey',
  reciprocalRelationshipType: 'tagKeyOf',
};
