# Seeded Relationship Templates

Relationship templates create known-good rules between seeded data sources when both data-source seeds exist in an installation.

## Template Format

Templates live in this directory and are exported by `getRelationshipSeeds()`:

```js
{
  name: 'GitHub repo → collaborators',
  description: 'Links each GitHub repository to the collaborator records fetched from that repository.',
  sourceSeedName: 'GitHub repositories',
  targetSeedName: 'GitHub collaborators (per repo)',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  sourceFieldExpression: 'full_name',
  targetFieldExpression: '_parent.full_name',
  relationshipType: 'hasCollaborator',
  reciprocalRelationshipType: 'collaboratorOf',
}
```

## Resolution Rule

Templates reference data sources by stable seed `name`, not by UUID. At apply time the seed materializer loads matching `catalog_workflows` rows and resolves:

- `sourceSeedName` -> source workflow `id`
- `targetSeedName` -> target workflow `id`

Those workflow ids are the datastore datasource ids.

## Guards

- Both endpoints are required. If either seed name is missing from `catalog_workflows`, the template is skipped and logged.
- Creation is idempotent. Before creating a rule, the materializer checks existing rules for the same endpoints, field expressions, relationship type, and reciprocal relationship type — a structurally-identical rule (any origin) is skipped, so seeds never duplicate an existing rule.
- Seeded rules are created with `origin: 'seed'` (set server-side for service callers — users cannot spoof it) and `state: 'active'`.
- Only `field-matching` templates belong here. Identity joins that require API lookups belong to the integration-backed relationship path.

## Adding A Template

1. Confirm both data-source seed names in `plugins/catalog-workflow-backend/seeds/`.
2. Confirm the child datasource carries the parent join value.
3. Add one relationship template file with `sourceSeedName` and `targetSeedName`.
4. Export it from `relationships/index.js`.
5. Add or update materializer tests for endpoint resolution, missing endpoints, and idempotency.

## Templates

- GitHub repositories -> collaborators
- GitHub organizations -> teams
- GitHub organizations -> organization members
- GitHub repositories -> pull requests
- GitHub repositories -> releases
- GitHub repositories -> Actions workflows
- GitHub repositories -> Dependabot alerts
- GitHub team -> child teams
- GitHub repo -> catalog-info.yaml files
- GitHub repo -> YAML files
- GitHub repo -> markdown files
- GitHub org member -> collaborators
- GitHub org member -> pull requests
- GitHub org member -> releases
- GitHub repo -> GitHub App repo
- GitLab groups -> projects
- GitLab groups -> group members
- GitLab projects -> project members
- GitLab projects -> issues
- GitLab projects -> merge requests
- GitLab projects -> pipelines
- GitLab projects -> environments
- GitLab group -> child groups
- GitLab group -> descendant groups
- GitLab project -> deployments
- GitLab project -> tags
- GitLab project -> releases
- GitLab environment -> deployments
- GitLab tag -> releases
- Azure DevOps projects -> repositories
- Azure DevOps projects -> pipelines
- Azure DevOps projects -> pull requests
- Azure DevOps repository -> pull requests
- Azure DevOps project -> teams
- Azure DevOps project -> service connections
- Azure DevOps service connection -> Azure subscription
- Azure subscription -> resource groups
- Azure subscription -> resources
- Azure subscription -> virtual machines
- Azure subscription -> storage accounts
- Azure subscription -> key vaults
- Azure subscription -> managed clusters
- Azure resource -> virtual machines
- Azure resource -> storage accounts
- Azure resource -> key vaults
- Azure resource -> managed clusters
- Entra ID user -> groups
- Entra ID application -> service principals
- Entra ID application -> agent identities
- Entra ID domain -> applications
- Entra ID domain -> users
- LaunchDarkly projects -> feature flags
- LaunchDarkly projects -> environments
- LaunchDarkly project -> metrics
- LaunchDarkly member -> audit log
- LaunchDarkly team -> members
- PagerDuty services -> incidents
- PagerDuty team -> services
- PagerDuty team -> incidents
- PagerDuty team -> escalation policies
- PagerDuty escalation policy -> services
- PagerDuty escalation policy -> incidents
- PagerDuty escalation policy -> on-calls
- PagerDuty user -> on-calls
- PagerDuty user -> incidents
- Shortcut member -> groups
- Shortcut group -> epics
- Shortcut group -> iterations
- Shortcut project -> epics
- Shortcut iteration -> epics
- Entra ID user -> PagerDuty user
- Entra ID user -> LaunchDarkly member
- Entra ID user -> Shortcut member
- PagerDuty user -> LaunchDarkly member
- PagerDuty user -> Shortcut member
- LaunchDarkly member -> Shortcut member
- AWS tagged resources -> AWS resources by ARN
- AWS account -> AWS resources
- AWS VPC -> subnets
- AWS VPC -> security groups
- AWS VPC -> NAT gateways
- AWS VPC -> internet gateways
- AWS EC2 instance -> subnet
- AWS EC2 instance -> security groups
- AWS EC2 instance -> volumes
- AWS ELBv2 load balancer -> target groups
- AWS RDS DB cluster -> instances
- AWS ECS cluster -> services
- AWS ECS task definition -> services
- AWS EKS cluster -> node groups
- AWS Lambda function -> event source mappings
- AWS ECR repository -> GitHub repository
- AWS EKS cluster -> Kubernetes namespaces
- AWS account -> Wiz cloud resources
- AWS CloudFormation stack -> tagged resources
