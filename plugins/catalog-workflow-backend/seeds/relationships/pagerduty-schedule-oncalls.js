module.exports = {
  name: 'PagerDuty schedule → on-calls',
  description:
    'Links each PagerDuty schedule to on-call records that reference that schedule.',
  sourceSeedName: 'PagerDuty schedules',
  targetSeedName: 'PagerDuty on-calls',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'id',
  targetFieldExpression: 'schedule.id',
  relationshipType: 'hasOnCall',
  reciprocalRelationshipType: 'onCallSchedule',
};
