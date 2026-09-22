/*
 * Copyright 2026 Larder Software Limited
 */
const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../../builders');

module.exports = {
  name: 'GitHub Copilot metrics (28-day)',
  description:
    'Latest 28-day aggregated Copilot usage report per organization: report window plus signed download links for the full metrics files. One record per org, refreshed as GitHub publishes new daily reports; requires Copilot usage metrics access on the org.',
  integrationSlug: 'github-token',
  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 24, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-orgs',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/user/orgs',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'login',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List organizations',
        ),
        chainedSourceNode(
          'get-copilot-metrics-report',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/orgs/{{login}}/copilot/metrics/reports/organization-28-day/latest',
            method: 'GET',
            // [$] wraps the report object explicitly: with a bare '$' the
            // extractor's array auto-detection latches onto the report's
            // nested download_links array instead of the report itself.
            arrayExpression: '[$]',
            objectIdExpression: 'report_end_day',
            resultMode: 'flatten',
          },
          'Get latest 28-day report per org',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '_parent.login', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-orgs'),
        edge('e2', 'list-orgs', 'get-copilot-metrics-report'),
        edge('e3', 'get-copilot-metrics-report', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
