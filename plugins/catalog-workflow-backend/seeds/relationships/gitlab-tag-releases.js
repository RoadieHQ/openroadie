module.exports = {
  name: 'GitLab tag → releases',
  description: 'Links GitLab tags to releases for the same project tag name.',
  sourceSeedName: 'GitLab tags',
  targetSeedName: 'GitLab releases',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(_parent.id) & ":" & name',
  targetFieldExpression: '$string(_parent.id) & ":" & tag_name',
  relationshipType: 'releasedAs',
  reciprocalRelationshipType: 'releaseForTag',
};
