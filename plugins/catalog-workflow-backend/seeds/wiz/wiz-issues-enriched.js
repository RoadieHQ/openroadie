const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

const ENRICHED_ISSUES_QUERY = `query EnrichedIssuesTable($filterBy: IssueFilters, $first: Int, $after: String, $orderBy: IssueOrder) {
  issuesV2(filterBy: $filterBy, first: $first, after: $after, orderBy: $orderBy) {
    nodes {
      id
      sourceRule {
        __typename
        ... on Control {
          id
          name
          description
          resolutionRecommendation
          securitySubCategories {
            title
            category {
              name
              framework {
                name
              }
            }
          }
        }
        ... on CloudEventRule {
          id
          name
          description
          sourceType
          type
        }
        ... on CloudConfigurationRule {
          id
          name
          description
          remediationInstructions
          serviceType
        }
      }
      type
      createdAt
      updatedAt
      dueAt
      projects {
        id
        name
        slug
        projectOwners {
          name
        }
        securityChampions {
          name
        }
        businessUnit
        riskProfile {
          businessImpact
        }
      }
      status
      severity
      entitySnapshot {
        id
        type
        nativeType
        name
        status
        cloudPlatform
        cloudProviderURL
        providerId
        region
        resourceGroupExternalId
        subscriptionExternalId
        subscriptionName
        subscriptionTags
        tags
        externalId
      }
      serviceTickets {
        externalId
        name
        url
      }
      notes {
        id
        createdAt
        updatedAt
        text
        user {
          name
          email
        }
        serviceAccount {
          name
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
  name: 'Wiz issues enriched',
  description:
    'List open Wiz issues with project ownership, source rule details, affected entity metadata, service tickets, and notes.',
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
          'list-issues-enriched',
          { x: 280, y: 0 },
          {
            integrationId,
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphql: {
              query: ENRICHED_ISSUES_QUERY,
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
          'List enriched issues',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-issues-enriched'),
        edge('e2', 'list-issues-enriched', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
