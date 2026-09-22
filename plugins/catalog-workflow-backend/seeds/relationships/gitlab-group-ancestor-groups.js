module.exports = {
  name: 'GitLab group → descendant groups',
  description:
    'Links each GitLab group to descendant groups that include it in their ancestor group IDs.',
  sourceSeedName: 'GitLab groups',
  targetSeedName: 'GitLab groups',
  strategy: 'field-matching',
  matchStrategy: 'array_contains',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: 'ancestorGroupIds',
  relationshipType: 'ancestorOf',
  reciprocalRelationshipType: 'descendantOf',
};
