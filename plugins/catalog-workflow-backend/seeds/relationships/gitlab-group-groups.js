module.exports = {
  name: 'GitLab group → child groups',
  description:
    'Links each GitLab group to subgroups that reference it as their parent group.',
  sourceSeedName: 'GitLab groups',
  targetSeedName: 'GitLab groups',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: '$string(id)',
  targetFieldExpression: 'parentGroupId',
  relationshipType: 'parentOf',
  reciprocalRelationshipType: 'childOf',
};
