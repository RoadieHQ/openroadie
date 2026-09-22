export interface PathSuggestion {
  path: string;
  description: string;
}

const GITHUB_PATH_SUGGESTIONS: PathSuggestion[] = [
  {
    path: '/orgs/{org}/repos',
    description: 'List organization repositories',
  },
  { path: '/repos/{owner}/{repo}', description: 'Get a repository' },
  { path: '/repos/{owner}/{repo}/pulls', description: 'List pull requests' },
  { path: '/repos/{owner}/{repo}/issues', description: 'List issues' },
  { path: '/users/{username}/repos', description: 'List user repositories' },
  { path: '/orgs/{org}/members', description: 'List organization members' },
];

export const INTEGRATION_PATH_SUGGESTIONS: Record<string, PathSuggestion[]> = {
  pagerduty: [
    { path: '/services', description: 'List all services' },
    { path: '/services/{service_id}', description: 'Get a service by ID' },
    { path: '/incidents', description: 'List incidents' },
    { path: '/teams', description: 'List teams' },
    { path: '/users', description: 'List users' },
    { path: '/escalation_policies', description: 'List escalation policies' },
    { path: '/schedules', description: 'List schedules' },
  ],
  'github-token': GITHUB_PATH_SUGGESTIONS,
  'github-app': GITHUB_PATH_SUGGESTIONS,
  gitlab: [
    { path: '/api/v4/projects', description: 'List projects' },
    { path: '/api/v4/groups', description: 'List groups' },
    {
      path: '/api/v4/groups/{id}/projects',
      description: 'List group projects',
    },
    { path: '/api/v4/users', description: 'List users' },
    {
      path: '/api/v4/projects/{id}/merge_requests',
      description: 'List project merge requests',
    },
    {
      path: '/api/v4/projects/{id}/issues',
      description: 'List project issues',
    },
    { path: '/api/v4/groups/{id}/members', description: 'List group members' },
    {
      path: '/api/v4/projects/{id}/members/all',
      description: 'List project members (inherited)',
    },
    {
      path: '/api/v4/projects/{id}/repository/tags',
      description: 'List repository tags',
    },
    {
      path: '/api/v4/projects/{id}/releases',
      description: 'List releases',
    },
    {
      path: '/api/v4/projects/{id}/pipelines',
      description: 'List CI/CD pipelines',
    },
    {
      path: '/api/v4/projects/{id}/environments',
      description: 'List environments',
    },
    {
      path: '/api/v4/projects/{id}/deployments',
      description: 'List deployments',
    },
  ],
  circleci: [
    {
      path: '/api/v2/me/collaborations',
      description: 'List organizations the token collaborates with',
    },
    {
      path: '/api/v2/pipeline?org-slug={orgSlug}',
      description: 'List pipelines for an organization slug',
    },
    {
      path: '/api/v2/pipeline/{pipelineId}/workflow',
      description: 'List workflows for a pipeline',
    },
    {
      path: '/api/v2/workflow/{workflowId}/job',
      description: 'List jobs for a workflow',
    },
    {
      path: '/project/{vcs}/{org}/{repo}/pipeline',
      description: 'List pipelines for a project',
    },
    {
      path: '/insights/{vcs}/{org}/{repo}/workflows',
      description: 'Get workflow insights',
    },
  ],
  snyk: [
    {
      path: '/rest/orgs?version=2025-11-05',
      description: 'List organizations',
    },
    {
      path: '/rest/orgs/{org_id}/projects?version=2025-11-05',
      description: 'List organization projects',
    },
    {
      path: '/rest/orgs/{org_id}/memberships?version=2025-11-05',
      description: 'List organization memberships',
    },
    {
      path: '/rest/orgs/{org_id}/targets?version=2025-11-05',
      description: 'List organization targets',
    },
    {
      path: '/rest/orgs/{org_id}?version=2025-11-05',
      description: 'Get organization details',
    },
  ],
  buildkite: [
    {
      path: '/organizations/{org}/pipelines',
      description: 'List organization pipelines',
    },
    { path: '/builds', description: 'List builds' },
    {
      path: '/organizations/{org}/builds',
      description: 'List organization builds',
    },
  ],
  launchdarkly: [
    { path: '/api/v2/projects', description: 'List projects' },
    { path: '/api/v2/flags/{projectKey}', description: 'List feature flags' },
    { path: '/api/v2/members', description: 'List members' },
  ],
  bugsnag: [
    { path: '/user/organizations', description: 'List user organizations' },
    {
      path: '/organizations/{org_id}/projects',
      description: 'List organization projects',
    },
    {
      path: '/projects/{project_id}/errors',
      description: 'List project errors',
    },
  ],
  datadog: [
    { path: '/api/v1/monitor', description: 'List monitors' },
    { path: '/api/v2/services', description: 'List services' },
    { path: '/api/v1/dashboard', description: 'List dashboards' },
  ],
  sonarcloud: [
    { path: '/api/projects/search', description: 'Search projects' },
    { path: '/api/measures/component', description: 'Get component measures' },
    { path: '/api/issues/search', description: 'Search issues' },
  ],
  rootly: [
    { path: '/v1/services', description: 'List services' },
    { path: '/v1/incidents', description: 'List incidents' },
    { path: '/v1/teams', description: 'List teams' },
    { path: '/v1/functionalities', description: 'List functionalities' },
  ],
  incident: [
    { path: '/v2/incidents', description: 'List incidents' },
    { path: '/v2/catalog_entries', description: 'List catalog entries' },
    { path: '/v2/schedules', description: 'List schedules' },
    { path: '/v2/actions', description: 'List actions' },
  ],
  harness: [
    { path: '/gateway/ng/api/projects', description: 'List projects' },
    { path: '/gateway/ng/api/pipelines', description: 'List pipelines' },
    { path: '/gateway/ng/api/services', description: 'List services' },
  ],
  humanitec: [
    { path: '/orgs', description: 'List organizations' },
    { path: '/orgs/{orgId}/apps', description: 'List applications' },
    {
      path: '/orgs/{orgId}/apps/{appId}/envs',
      description: 'List environments for an application',
    },
    {
      path: '/orgs/{orgId}/resources/defs',
      description: 'List resource definitions',
    },
  ],
  pulumi: [
    {
      path: '/api/user',
      description: 'Get the authenticated user and accessible organizations',
    },
    {
      path: '/api/user/stacks?organization={orgName}',
      description: 'List stacks for an organization',
    },
    {
      path: '/api/stacks/{orgName}/{projectName}/{stackName}/deployments',
      description: 'List deployments for a stack',
    },
    {
      path: '/api/orgs/{org}/members',
      description: 'List organization members',
    },
    { path: '/api/orgs/{org}/teams', description: 'List organization teams' },
  ],
  shortcut: [
    { path: '/api/v3/projects', description: 'List projects' },
    { path: '/api/v3/stories', description: 'List stories' },
    { path: '/api/v3/members', description: 'List members' },
    { path: '/api/v3/epics', description: 'List epics' },
  ],
  'microsoft-graph': [
    { path: '/v1.0/users', description: 'List users' },
    { path: '/v1.0/users/{id}', description: 'Get user by ID' },
    { path: '/v1.0/groups', description: 'List groups' },
    { path: '/v1.0/groups/{id}/members', description: 'List group members' },
    { path: '/v1.0/teams', description: 'List teams' },
    { path: '/v1.0/teams/{id}/channels', description: 'List team channels' },
    { path: '/v1.0/applications', description: 'List applications' },
    { path: '/v1.0/organization', description: 'Get organization info' },
  ],
};

export function extractPathParams(template: string): string[] {
  const params: string[] = [];
  let i = 0;
  while (i < template.length) {
    const start = template.indexOf('{', i);
    if (start === -1) {
      break;
    }
    if (template[start + 1] === '{') {
      const endDouble = template.indexOf('}}', start + 2);
      i = endDouble === -1 ? start + 2 : endDouble + 2;
      continue;
    }
    const end = template.indexOf('}', start + 1);
    if (end === -1) {
      break;
    }
    params.push(template.slice(start + 1, end));
    i = end + 1;
  }
  return params;
}

export function buildPath(
  template: string,
  params: Record<string, string>,
): string {
  const paramMap = new Map(Object.entries(params));
  let result = '';
  let i = 0;
  while (i < template.length) {
    const start = template.indexOf('{', i);
    if (start === -1) {
      result += template.slice(i);
      break;
    }
    if (template.charAt(start + 1) === '{') {
      const endDouble = template.indexOf('}}', start + 2);
      if (endDouble === -1) {
        result += template.slice(i);
        break;
      }
      result += template.slice(i, endDouble + 2);
      i = endDouble + 2;
      continue;
    }
    result += template.slice(i, start);
    const end = template.indexOf('}', start + 1);
    if (end === -1) {
      result += template.slice(start);
      break;
    }
    const key = template.slice(start + 1, end);
    result += paramMap.get(key) || `{${key}}`;
    i = end + 1;
  }
  return result;
}
