const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

const ISSUE_THREAT_DETECTION_DETAILS_QUERY = `query IssueThreatDetectionDetails($filterBy: IssueFilters, $first: Int, $after: String, $orderBy: IssueOrder) {
  issuesV2(filterBy: $filterBy, first: $first, after: $after, orderBy: $orderBy) {
    nodes {
      id
      type
      evidenceQuery
      threatDetectionDetails {
        ... on ThreatDetectionIssueDetails {
          actors {
            id
            name
            externalId
            providerUniqueId
            type
          }
          resources {
            id
            name
            externalId
            providerUniqueId
            type
            nativeType
          }
          mainDetection {
            id
            startedAt
            severity
            description(format: MARKDOWN)
            ruleMatch {
              rule {
                id
                name
                origins
              }
            }
          }
          detections(first: 100) {
            nodes {
              id
              startedAt
              severity
              description(format: MARKDOWN)
              primaryResource {
                id
                type
                name
                externalId
                region
                cloudAccount {
                  id
                  name
                  externalId
                  cloudProvider
                }
              }
              actors {
                id
                name
                externalId
                providerUniqueId
                type
              }
            }
          }
          cloudEventGroups(first: 100) {
            nodes {
              id
              name
              firstEventAt
              lastEventAt
              status
              kind
              origin
              groupType
              description
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

module.exports = {
  name: 'Wiz issue threat detection details',
  description:
    'List open Wiz issues with threat-detection evidence, actors, resources, detections, and cloud event group summaries.',
  integrationSlug: 'wiz',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-issue-threat-detection-details',
          { x: 280, y: 0 },
          {
            integrationId,
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphql: {
              query: ISSUE_THREAT_DETECTION_DETAILS_QUERY,
              variables: {
                first: 100,
                filterBy: { status: ['OPEN', 'IN_PROGRESS'] },
                orderBy: { field: 'SEVERITY', direction: 'DESC' },
              },
            },
            arrayExpression: 'data.issuesV2.nodes',
            objectIdExpression: 'id',
            pagination: {
              type: 'graphql-cursor',
              cursorVariable: 'after',
              nextCursorExpression: 'data.issuesV2.pageInfo.endCursor',
              hasNextPageExpression: 'data.issuesV2.pageInfo.hasNextPage',
            },
          },
          'List issue threat details',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-issue-threat-detection-details'),
        edge('e2', 'list-issue-threat-detection-details', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
