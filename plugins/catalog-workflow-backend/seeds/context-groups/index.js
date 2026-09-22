/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function getLegacyContextGroupSeeds() {
  return [
    {
      name: 'Repositories',
      slug: 'repositories',
      description:
        'Groups repository records with pull requests, releases, actions, collaborators, alerts, files, and equivalent GitHub App and enterprise repository records.',
      seedNames: [
        'GitHub repositories',
        'GitHub App repositories',
        'GitHub Enterprise repositories',
        'GitHub Enterprise App repositories',
        'GitLab projects',
        'Azure DevOps repositories',
      ],
      mergeRelationshipTypes: ['sameRepository'],
    },
    {
      name: 'People',
      slug: 'people',
      description:
        'Groups person records across identity, source control, incident, feature flag, and project management systems.',
      seedNames: [
        'Entra ID users',
        'GitHub organization members',
        'GitHub Enterprise organization members',
        'GitLab group members',
        'PagerDuty users',
        'LaunchDarkly members',
        'Shortcut members',
      ],
      mergeRelationshipTypes: ['samePerson'],
      annotations: [
        {
          title: 'Identity resolution',
          text: 'Each group represents one person across systems. Root records linked by "samePerson" are the same human — merge them when reasoning about the individual.',
        },
      ],
    },
    {
      name: 'Teams and Groups',
      slug: 'teams',
      description:
        'Groups team and group records with members and owned work across source control, identity, incident, feature flag, and project management systems.',
      seedNames: [
        'GitHub organizations',
        'GitHub teams',
        'GitHub Enterprise organizations',
        'GitHub Enterprise teams',
        'GitLab groups',
        'Entra ID groups',
        'PagerDuty teams',
        'LaunchDarkly teams',
        'Shortcut groups',
        'Azure DevOps teams',
      ],
    },
    {
      name: 'Cloud Accounts and Subscriptions',
      slug: 'cloud-resources',
      description:
        'Groups cloud account or subscription roots with resource groups, resources, common infrastructure objects, and service connections.',
      seedNames: ['Azure subscriptions'],
      mergeRelationshipTypes: ['sameResource'],
    },
    {
      name: 'Delivery Pipelines',
      slug: 'delivery-pipelines',
      description:
        'Groups CI/CD pipeline records with workflow and job records where the pipeline hierarchy is deterministic.',
      seedNames: [
        'GitHub Actions workflows',
        'GitHub App Actions workflows',
        'GitHub Enterprise Actions workflows',
        'GitHub Enterprise App Actions workflows',
        'GitLab pipelines',
        'Azure DevOps pipelines',
        'CircleCI pipelines (all organizations)',
      ],
    },
    {
      name: 'Incident Response',
      slug: 'incident-response',
      description:
        'Groups incident response services, policies, schedules, on-call records, responders, and incidents.',
      seedNames: [
        'PagerDuty services',
        'PagerDuty escalation policies',
        'PagerDuty schedules',
      ],
    },
    {
      name: 'Feature Management',
      slug: 'feature-management',
      description:
        'Groups feature management projects with flags, environments, metrics, members, teams, and audit activity.',
      seedNames: ['LaunchDarkly projects'],
    },
    {
      name: 'Work Planning',
      slug: 'work-planning',
      description:
        'Groups project planning records around Shortcut projects, epics, iterations, groups, and members.',
      seedNames: ['Shortcut projects'],
    },
    {
      name: 'Infrastructure Stacks',
      slug: 'infrastructure-stacks',
      description:
        'Groups infrastructure-as-code stacks with their deployment records.',
      seedNames: [
        'Pulumi stacks (all organizations)',
        'Terraform Cloud workspaces (all organizations)',
      ],
    },
    {
      name: 'Runtime Environments',
      slug: 'runtime-environments',
      description:
        'Groups runtime applications and environments with deployment records where the environment hierarchy is explicit.',
      seedNames: [
        'Humanitec applications (organization discovery)',
        'GitLab environments',
      ],
    },
    {
      name: 'Vulnerability Management',
      slug: 'vulnerability-management',
      description:
        'Groups vulnerability management organizations, targets, projects, memberships, and repository-scoped security alerts.',
      seedNames: [
        'Snyk organizations (all organizations)',
        'GitHub repositories',
        'GitHub App repositories',
        'GitHub Enterprise repositories',
        'GitHub Enterprise App repositories',
      ],
    },
  ];
}

const additionsBySlug = {
  repositories: {
    seedNames: [
      'Bitbucket Cloud repositories',
      'Bitbucket Server repositories',
    ],
  },
  people: {
    seedNames: [
      'Slack users',
      'incident.io users',
      'Google Workspace users',
      'Okta users',
      'Bitbucket Server users',
      'Anthropic organization members',
      'Cursor team members',
      'OpenAI organization users',
      'Jira users',
      'Linear users',
      'Sentry members (all organizations)',
    ],
  },
  'cloud-resources': {
    seedNames: ['GCP organizations'],
  },
  'delivery-pipelines': {
    seedNames: ['Buildkite pipelines (all organizations)'],
  },
  'incident-response': {
    seedNames: ['incident.io incidents'],
  },
  'work-planning': {
    seedNames: ['Jira projects', 'Linear projects'],
  },
  'runtime-environments': {
    seedNames: ['Kubernetes namespaces'],
  },
};

// Version-3 additions: new root data sources added to already-seeded groups
// after the version-2 rewrite. Only slugs listed here get a version bump, so
// unrelated groups aren't re-pushed on every seed run.
const v3AdditionsBySlug = {
  teams: {
    seedNames: ['Microsoft Teams teams'],
  },
  'vulnerability-management': {
    seedNames: [
      'Wiz projects',
      'Wiz issues',
      'Wiz issues enriched',
      'Wiz issue threat detection details',
      'Wiz cloud resources',
      'Wiz vulnerability findings',
      'Wiz version control resources',
      'Wiz issues (per project)',
    ],
    description:
      'Groups vulnerability management, cloud security, and repository records across Snyk, GitHub, and Wiz.',
  },
};

const v4AdditionsBySlug = {
  people: {
    seedNames: [
      'GitHub App organization members',
      'GitHub Enterprise App organization members',
    ],
  },
  teams: {
    seedNames: ['GitHub App teams', 'GitHub Enterprise App teams'],
  },
  'cloud-resources': {
    seedNames: [
      'AWS Organizations accounts',
      'AWS tagged resources',
      'AWS EC2 Elastic IPs',
      'AWS EC2 instances',
      'AWS EC2 internet gateways',
      'AWS EC2 NAT gateways',
      'AWS EC2 security groups',
      'AWS EC2 subnets',
      'AWS EC2 volumes',
      'AWS EC2 VPCs',
      'AWS EFS file systems',
      'AWS ECR repositories',
      'AWS S3 buckets',
      'AWS RDS DB clusters',
      'AWS RDS DB instances',
      'AWS RDS DB snapshots',
      'AWS Redshift clusters',
      'AWS ElastiCache clusters',
      'AWS ElastiCache replication groups',
      'AWS App Runner services',
    ],
    description:
      'Groups cloud account, subscription, organization, and AWS resource records.',
  },
  'runtime-environments': {
    seedNames: [
      'AWS Batch compute environments',
      'AWS Batch job queues',
      'AWS ECS clusters',
      'AWS ECS services',
      'AWS ECS task definitions',
      'AWS EKS clusters',
      'AWS EKS node groups',
      'AWS Lambda functions',
    ],
    description:
      'Groups runtime application, environment, container, serverless, and compute records.',
  },
  'infrastructure-stacks': {
    seedNames: ['AWS CloudFormation stacks'],
    description:
      'Groups infrastructure-as-code stacks across Pulumi, Terraform Cloud, and AWS CloudFormation.',
  },
};

const v5RewritesBySlug = {
  'cloud-resources': {
    seedNamesReplace: {
      'AWS Organizations accounts': 'AWS accounts',
    },
  },
};

function replaceSeedNames(seedNames, replacements) {
  if (!replacements) {
    return seedNames;
  }
  return seedNames.map(name => replacements[name] ?? name);
}

// Version-2 rewrites: context groups no longer pull in associated records, so
// descriptions (and the People annotation) that promised them are re-worded to
// describe the data sources alone. previousVersions keep the original text so
// unversioned rules still match and upgrade.
const currentOverridesBySlug = {
  repositories: {
    description:
      'Groups equivalent repository records across GitHub, GitHub Enterprise, GitLab, Bitbucket, and Azure DevOps.',
  },
  people: {
    annotations: [
      {
        title: 'Identity resolution',
        text: 'Each group represents one person across systems. Records linked by "samePerson" are the same human — merge them when reasoning about the individual.',
      },
    ],
  },
  teams: {
    description:
      'Groups team and group records across source control, identity, incident, feature flag, and project management systems.',
  },
  'cloud-resources': {
    description:
      'Groups cloud account, subscription, and organization records.',
  },
  'delivery-pipelines': {
    description: 'Groups CI/CD pipeline records.',
  },
  'incident-response': {
    description:
      'Groups incident response services, escalation policies, schedules, and incidents.',
  },
  'feature-management': {
    description: 'Groups feature management projects.',
  },
  'work-planning': {
    description:
      'Groups project planning records across Shortcut, Jira, and Linear projects.',
  },
  'infrastructure-stacks': {
    description: 'Groups infrastructure-as-code stacks.',
  },
  'runtime-environments': {
    description: 'Groups runtime application and environment records.',
  },
  'vulnerability-management': {
    description:
      'Groups vulnerability management organizations and repository records.',
  },
};

const newContextGroupSeeds = [
  {
    name: 'Service Health and Observability',
    slug: 'service-health-observability',
    description:
      'Groups observability projects, monitors, services, problems, issues, SLOs, and synthetic monitor details.',
    seedNames: [
      'Sentry projects (all organizations)',
      'Datadog monitors',
      'Datadog service definitions',
      'Dynatrace services',
      'Dynatrace problems (last 30 days)',
      'Dynatrace synthetic monitors',
    ],
  },
  {
    name: 'Software Quality',
    slug: 'software-quality',
    description:
      'Groups SonarQube projects with their issues and branch records.',
    seedNames: ['SonarQube projects'],
  },
  {
    name: 'AI Platforms and Usage',
    slug: 'ai-platforms-usage',
    description:
      'Groups AI platform identities, projects, workspaces, usage, spend, memberships, service accounts, and API keys.',
    seedNames: [
      'GitHub Copilot seats',
      'GitHub Copilot metrics (28-day)',
      'GitHub Copilot billing summary',
      'Cursor team members',
      'Cursor audit logs (last 7 days)',
      'Anthropic workspaces',
      'Anthropic organization members',
      'Anthropic organization invites',
      'Anthropic API keys',
      'OpenAI projects',
      'OpenAI organization users',
    ],
    mergeRelationshipTypes: ['samePerson'],
  },
  {
    name: 'Communication Spaces',
    slug: 'communication-spaces',
    description:
      'Groups Slack channels and user groups with membership records and users.',
    seedNames: ['Slack channels', 'Slack user groups'],
  },
  {
    name: 'Identity Applications',
    slug: 'identity-applications',
    description:
      'Groups Entra ID applications with service principals and agent identities.',
    seedNames: ['Entra ID applications'],
  },
  {
    name: 'Cloud Security and Governance',
    slug: 'cloud-security-governance',
    description:
      'Groups cloud security controls, audit trails, and governance policies across AWS.',
    seedNames: [
      'AWS GuardDuty detectors',
      'AWS CloudTrail trails',
      'AWS WAFv2 Web ACLs',
    ],
  },
];

const newSeedOverridesBySlug = {
  'service-health-observability': {
    description:
      'Groups observability projects, monitors, services, and problems.',
  },
  'software-quality': {
    description: 'Groups SonarQube projects.',
  },
  'ai-platforms-usage': {
    description:
      'Groups AI platform identities, projects, workspaces, seats, and API keys.',
  },
  'communication-spaces': {
    description: 'Groups Slack channels and user groups.',
  },
  'identity-applications': {
    description: 'Groups Entra ID applications.',
  },
  'cloud-security-governance': {
    description: 'Groups cloud security controls and audit records.',
  },
};

const newSeedV3AdditionsBySlug = {
  'communication-spaces': {
    seedNames: ['Microsoft Teams channels (per team)'],
  },
};

const newSeedV4AdditionsBySlug = {
  'identity-applications': {
    seedNames: [
      'AWS IAM groups',
      'AWS IAM instance profiles',
      'AWS IAM policies',
      'AWS IAM roles',
      'AWS IAM users',
      'AWS Cognito user pools',
    ],
    description:
      'Groups identity applications, directories, and AWS IAM identity records.',
  },
};

function addUnique(base, additions) {
  return [...new Set([...base, ...(additions || [])])];
}

function getContextGroupSeeds() {
  const upgradedSeeds = getLegacyContextGroupSeeds().map(seed => {
    const additions = additionsBySlug[seed.slug] || {};
    const v3Additions = v3AdditionsBySlug[seed.slug];
    // The version-1 definition (legacy + additions), kept for unversioned
    // rules created before seed versioning existed.
    const previousDefinition = {
      ...seed,
      seedNames: addUnique(seed.seedNames, additions.seedNames),
    };
    const v2Definition = {
      ...previousDefinition,
      ...(currentOverridesBySlug[seed.slug] || {}),
    };
    const v3Definition = v3Additions
      ? {
          ...v2Definition,
          seedNames: addUnique(v2Definition.seedNames, v3Additions.seedNames),
          ...(v3Additions.description
            ? { description: v3Additions.description }
            : {}),
        }
      : undefined;
    const v4Additions = v4AdditionsBySlug[seed.slug];
    if (v4Additions) {
      const baseDefinition = v3Definition || v2Definition;
      const v4Definition = {
        ...baseDefinition,
        seedNames: addUnique(baseDefinition.seedNames, v4Additions.seedNames),
        ...(v4Additions.description
          ? { description: v4Additions.description }
          : {}),
      };
      const v4PreviousVersions = [
        seed,
        previousDefinition,
        v2Definition,
        ...(v3Definition ? [v3Definition] : []),
      ];
      const v5Rewrite = v5RewritesBySlug[seed.slug];
      if (v5Rewrite) {
        return {
          ...v4Definition,
          seedNames: replaceSeedNames(
            v4Definition.seedNames,
            v5Rewrite.seedNamesReplace,
          ),
          version: 5,
          previousVersions: [...v4PreviousVersions, v4Definition],
        };
      }
      return {
        ...v4Definition,
        version: 4,
        previousVersions: v4PreviousVersions,
      };
    }
    if (v3Definition) {
      return {
        ...v3Definition,
        version: 3,
        previousVersions: [seed, previousDefinition, v2Definition],
      };
    }
    return {
      ...v2Definition,
      version: 2,
      previousVersions: [seed, previousDefinition],
    };
  });

  const upgradedNewSeeds = newContextGroupSeeds.map(seed => {
    const v2Definition = {
      ...seed,
      ...(newSeedOverridesBySlug[seed.slug] || {}),
    };
    const v3Additions = newSeedV3AdditionsBySlug[seed.slug];
    const v3Definition = v3Additions
      ? {
          ...v2Definition,
          seedNames: addUnique(v2Definition.seedNames, v3Additions.seedNames),
          ...(v3Additions.description
            ? { description: v3Additions.description }
            : {}),
        }
      : undefined;
    const v4Additions = newSeedV4AdditionsBySlug[seed.slug];
    if (v4Additions) {
      const baseDefinition = v3Definition || v2Definition;
      return {
        ...baseDefinition,
        seedNames: addUnique(baseDefinition.seedNames, v4Additions.seedNames),
        ...(v4Additions.description
          ? { description: v4Additions.description }
          : {}),
        version: 4,
        previousVersions: [
          seed,
          v2Definition,
          ...(v3Definition ? [v3Definition] : []),
        ],
      };
    }
    if (v3Definition) {
      return {
        ...v3Definition,
        version: 3,
        previousVersions: [seed, v2Definition],
      };
    }
    return {
      ...v2Definition,
      version: 2,
      previousVersions: [seed],
    };
  });

  return [...upgradedSeeds, ...upgradedNewSeeds];
}

module.exports = { getContextGroupSeeds };
