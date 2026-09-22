module.exports = {
  name: 'Terraform Cloud workspace → GitHub repository',
  description:
    'Links each Terraform Cloud workspace to the GitHub repository it is connected to via VCS settings, matching the workspace vcs-repo HTTP URL against the repository html_url.',
  sourceSeedName: 'Terraform Cloud workspaces (all organizations)',
  targetSeedName: 'GitHub repositories',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression:
    '$lowercase(attributes.`vcs-repo`.`repository-http-url`)',
  targetFieldExpression: '$lowercase(html_url)',
  relationshipType: 'deploysFrom',
  reciprocalRelationshipType: 'deployedBy',
};
