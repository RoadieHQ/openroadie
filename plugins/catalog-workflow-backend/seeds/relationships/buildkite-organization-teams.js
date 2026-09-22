module.exports = {
  name: 'Buildkite organization → teams',
  description:
    'Links each Buildkite organization to team records fetched from that organization.',
  sourceSeedName: 'Buildkite organizations',
  targetSeedName: 'Buildkite teams (all organizations)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: '_parent.id',
  relationshipType: 'hasTeam',
  reciprocalRelationshipType: 'teamOf',
};
