module.exports = [
  {
    name: 'OpenAI project → service accounts',
    description:
      'Links OpenAI projects to service accounts created in each project.',
    sourceSeedName: 'OpenAI projects',
    targetSeedName: 'OpenAI project service accounts',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'id',
    targetFieldExpression: '_parent.id',
    relationshipType: 'hasServiceAccount',
    reciprocalRelationshipType: 'serviceAccountOf',
  },
  {
    name: 'OpenAI user → project memberships',
    description:
      'Links OpenAI organization users to their project membership records.',
    sourceSeedName: 'OpenAI organization users',
    targetSeedName: 'OpenAI project members',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    sourceFieldExpression: 'id',
    targetFieldExpression: 'id',
    relationshipType: 'samePerson',
    reciprocalRelationshipType: 'samePerson',
  },
];
