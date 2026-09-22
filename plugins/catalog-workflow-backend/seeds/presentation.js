const DEFAULT_TITLE_PATHS = [
  'title',
  'displayName',
  'display_name',
  'full_name',
  'fullName',
  'path_with_namespace',
  'path',
  'profile.name',
  'profile.displayName',
  'profile.display_name',
  'real_name',
  'profile.real_name',
  'name.fullName',
  'attributes.name',
  'properties.name',
  'email',
  'mail',
  'emailAddress',
  'primaryEmail',
  'userPrincipalName',
  'login',
  'username',
  'label',
  'summary',
  'fields.summary',
  'message',
  'metadata.name',
  'repository.full_name',
  'team.name',
  'project.name',
  'key',
  'identifier',
  'slug',
  'repo',
  'domainName',
  'orgUnitPath',
  'stackName',
  'projectName',
  'name',
  'description',
  'value',
];

const DEFAULT_SUBTITLE_PATHS = [
  'email',
  'mail',
  'emailAddress',
  'primaryEmail',
  'userPrincipalName',
  'profile.email',
  'profile.email_address',
  'type',
  'kind',
  'entityType',
  'entity_type',
  'resourceType',
  'resource_type',
  'accountType',
  'state.name',
  'state',
  'status',
  'severity',
  'role',
  'handle',
  'key',
  'identifier',
  'slug',
  'path_with_namespace',
  'metadata.namespace',
  'namespace',
  '_parent.key',
  '_parent.full_name',
  '_parent.name',
  'repository.full_name',
  'team.key',
  'team.name',
  'project.key',
  'project.name',
  'repo',
  'server',
];

const DEFAULT_IMAGE_PATHS = [
  'profile.image_192',
  'profile.image_72',
  'avatar_url',
  'avatarUrl',
  'profile.avatar_url',
  'profile.avatarUrl',
  'image',
  'imageUrl',
  'picture',
];

const AWS_SERVICE_SUBTITLE = "_aws.accountId & ' - ' & _aws.region";
const AWS_CLOUD_CONTROL_SUBTITLE = "accountId & ' - ' & region";
const AWS_REVIEWED_ENTRIES = [
  ['AWS ACM certificates', 'CertificateArn', AWS_SERVICE_SUBTITLE],
  ['AWS API Gateway HTTP APIs', 'Name ? Name : ApiId', AWS_SERVICE_SUBTITLE],
  ['AWS AppConfig applications', 'Name ? Name : Id', AWS_SERVICE_SUBTITLE],
  ['AWS AppSync GraphQL APIs', 'name ? name : apiId', AWS_SERVICE_SUBTITLE],
  [
    'AWS App Runner services',
    'properties.ServiceName ? properties.ServiceName : identifier',
    AWS_CLOUD_CONTROL_SUBTITLE,
  ],
  ['AWS Auto Scaling groups', 'AutoScalingGroupName', AWS_SERVICE_SUBTITLE],
  [
    'AWS Backup plans',
    'BackupPlanName ? BackupPlanName : BackupPlanId',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS Backup vaults', 'BackupVaultName', AWS_SERVICE_SUBTITLE],
  [
    'AWS Batch compute environments',
    'computeEnvironmentName',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS Batch job queues', 'jobQueueName', AWS_SERVICE_SUBTITLE],
  [
    'AWS Bedrock foundation models',
    'modelName ? modelName : modelId',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS CloudFormation stacks', 'StackName', AWS_SERVICE_SUBTITLE],
  [
    'AWS CloudFront distributions',
    'DomainName ? DomainName : Id',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS CloudTrail trails', 'Name', AWS_SERVICE_SUBTITLE],
  ['AWS CloudWatch log groups', 'logGroupName', AWS_SERVICE_SUBTITLE],
  ['AWS CodeArtifact domains', 'name', AWS_SERVICE_SUBTITLE],
  ['AWS CodeArtifact repositories', 'name', 'domainName'],
  ['AWS CodeBuild projects', 'value', AWS_SERVICE_SUBTITLE],
  ['AWS CodePipeline pipelines', 'name', AWS_SERVICE_SUBTITLE],
  ['AWS Cognito user pools', 'Name ? Name : Id', AWS_SERVICE_SUBTITLE],
  [
    'AWS DynamoDB backups',
    'BackupName ? BackupName : BackupArn',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS DynamoDB tables', 'TableName', AWS_SERVICE_SUBTITLE],
  [
    'AWS EC2 Elastic IPs',
    'publicIp ? publicIp : allocationId',
    AWS_SERVICE_SUBTITLE,
  ],
  [
    'AWS EC2 instances',
    'instanceId',
    'instanceState.name ? instanceState.name : ' + AWS_SERVICE_SUBTITLE,
  ],
  ['AWS EC2 internet gateways', 'internetGatewayId', AWS_SERVICE_SUBTITLE],
  [
    'AWS EC2 NAT gateways',
    'natGatewayId',
    'state ? state : ' + AWS_SERVICE_SUBTITLE,
  ],
  [
    'AWS EC2 security groups',
    'groupName ? groupName : groupId',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS EC2 subnets', 'subnetId', 'vpcId ? vpcId : ' + AWS_SERVICE_SUBTITLE],
  ['AWS EC2 volumes', 'volumeId', 'status ? status : ' + AWS_SERVICE_SUBTITLE],
  ['AWS EC2 VPCs', 'vpcId', AWS_SERVICE_SUBTITLE],
  ['AWS ECR repositories', 'repositoryName', AWS_SERVICE_SUBTITLE],
  [
    'AWS ECS clusters',
    'clusterName ? clusterName : clusterArn',
    AWS_SERVICE_SUBTITLE,
  ],
  [
    'AWS ECS services',
    'serviceName ? serviceName : serviceArn',
    AWS_SERVICE_SUBTITLE,
  ],
  [
    'AWS ECS task definitions',
    'taskDefinition.family ? taskDefinition.family : taskDefinition.taskDefinitionArn',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS EFS file systems', 'Name ? Name : FileSystemId', AWS_SERVICE_SUBTITLE],
  ['AWS EKS clusters', 'name', AWS_SERVICE_SUBTITLE],
  ['AWS EKS node groups', 'nodegroupName', '_parent._parent.name'],
  ['AWS ElastiCache clusters', 'CacheClusterId', AWS_SERVICE_SUBTITLE],
  [
    'AWS ElastiCache replication groups',
    'ReplicationGroupId',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS ELBv2 load balancers', 'LoadBalancerName', AWS_SERVICE_SUBTITLE],
  ['AWS ELBv2 target groups', 'TargetGroupName', AWS_SERVICE_SUBTITLE],
  ['AWS EventBridge buses', 'Name', AWS_SERVICE_SUBTITLE],
  [
    'AWS EventBridge rules',
    'Name',
    'EventBusName ? EventBusName : ' + AWS_SERVICE_SUBTITLE,
  ],
  ['AWS Glue crawlers', 'Name', AWS_SERVICE_SUBTITLE],
  ['AWS Glue databases', 'Name', AWS_SERVICE_SUBTITLE],
  ['AWS Glue jobs', 'Name', AWS_SERVICE_SUBTITLE],
  ['AWS GuardDuty detectors', 'value', AWS_SERVICE_SUBTITLE],
  ['AWS IAM groups', 'GroupName', AWS_SERVICE_SUBTITLE],
  ['AWS IAM instance profiles', 'InstanceProfileName', AWS_SERVICE_SUBTITLE],
  ['AWS IAM policies', 'PolicyName', AWS_SERVICE_SUBTITLE],
  ['AWS IAM roles', 'RoleName', AWS_SERVICE_SUBTITLE],
  ['AWS IAM users', 'UserName', AWS_SERVICE_SUBTITLE],
  ['AWS KMS aliases', 'AliasName', AWS_SERVICE_SUBTITLE],
  ['AWS KMS keys', 'KeyId', AWS_SERVICE_SUBTITLE],
  [
    'AWS Lambda event source mappings',
    'FunctionArn ? FunctionArn : UUID',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS Lambda functions', 'FunctionName', AWS_SERVICE_SUBTITLE],
  [
    'AWS Lambda layers',
    'LayerName ? LayerName : LayerArn',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS OpenSearch domains', 'DomainName', AWS_SERVICE_SUBTITLE],
  ['AWS accounts', 'Name ? Name : Id', 'Status ? Status : Id'],
  ['AWS RDS DB clusters', 'DBClusterIdentifier', AWS_SERVICE_SUBTITLE],
  ['AWS RDS DB instances', 'DBInstanceIdentifier', AWS_SERVICE_SUBTITLE],
  ['AWS RDS DB snapshots', 'DBSnapshotIdentifier', AWS_SERVICE_SUBTITLE],
  ['AWS Redshift clusters', 'ClusterIdentifier', AWS_SERVICE_SUBTITLE],
  ['AWS Route53 hosted zones', 'Name', AWS_SERVICE_SUBTITLE],
  ['AWS S3 buckets', 'Name', AWS_SERVICE_SUBTITLE],
  ['AWS Secrets Manager secrets', 'Name', AWS_SERVICE_SUBTITLE],
  [
    'AWS SNS topic attributes',
    'DisplayName ? DisplayName : TopicArn',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS SNS topics', 'TopicArn', AWS_SERVICE_SUBTITLE],
  [
    'AWS SQS queues',
    'QueueArn ? QueueArn : _parent.value',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS SSM documents', 'Name', AWS_SERVICE_SUBTITLE],
  [
    'AWS SSM managed instances',
    'Name ? Name : InstanceId',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS SSM parameters', 'Name', AWS_SERVICE_SUBTITLE],
  [
    'AWS Step Functions activities',
    'name ? name : activityArn',
    AWS_SERVICE_SUBTITLE,
  ],
  [
    'AWS Step Functions state machines',
    'name ? name : stateMachineArn',
    AWS_SERVICE_SUBTITLE,
  ],
  ['AWS tagged resources', 'ResourceARN', AWS_SERVICE_SUBTITLE],
  ['AWS WAFv2 Web ACLs', 'Name ? Name : ARN', AWS_SERVICE_SUBTITLE],
];

const reviewedEntries = [
  ['GitHub repositories', 'full_name', 'description ? description : language'],
  ['GitHub organizations', 'login', 'description'],
  [
    'GitHub open pull requests',
    'title',
    '$replace(repository_url, "https://api.github.com/repos/", "")',
  ],
  [
    'GitHub pull requests (per repo)',
    'title',
    "'#' & $string(number) & ' - ' & _parent.full_name",
  ],
  [
    'GitHub merged pull requests (per repo)',
    'title',
    "'#' & $string(number) & ' - ' & repo_full_name",
  ],
  ['GitHub releases (per repo)', 'name ? name : tag_name', '_parent.full_name'],
  ['GitHub Actions workflows', 'name', '_parent.full_name'],
  [
    'GitHub installed apps',
    'app_slug',
    "account.login & ' (' & account.type & ')'",
  ],
  ['GitHub codespaces', 'name', "repository.full_name & ' - ' & state"],
  [
    'GitHub organization members',
    'name ? name : login',
    'email ? email : _parent._parent.login',
  ],
  ['GitHub teams', 'name', '_parent.login'],
  [
    'GitHub Dependabot alerts (per repo)',
    'security_advisory.summary',
    "dependency.package.name & ' - ' & security_vulnerability.severity",
  ],
  ['GitHub collaborators (per repo)', 'login', '_parent.full_name'],
  ['GitHub catalog-info.yaml files', 'path', 'repository.full_name'],
  ['GitHub markdown files', 'path', 'repository.full_name'],
  ['GitHub YAML files', 'path', 'repository.full_name'],
  [
    'GitHub Copilot seats',
    "assignee.login ? assignee.login : 'Pending seat'",
    '_parent.login',
  ],
  ['GitHub Copilot billing summary', '_parent.login', 'plan_type'],
  [
    'GitHub Copilot metrics (28-day)',
    '_parent.login',
    "report_start_day & ' to ' & report_end_day",
  ],
  ['GitHub App installation', 'account.login', 'target_type'],
  ['GitHub App organization members', 'login', '_parent.account.login'],
  ['GitHub App teams', 'name', '_parent.account.login'],
  [
    'GitHub App repositories',
    'full_name',
    'description ? description : language',
  ],
  [
    'GitHub App pull requests (per repo)',
    'title',
    "'#' & $string(number) & ' - ' & _parent.full_name",
  ],
  [
    'GitHub App merged pull requests (per repo)',
    'title',
    "'#' & $string(number) & ' - ' & repo_full_name",
  ],
  [
    'GitHub App releases (per repo)',
    'name ? name : tag_name',
    '_parent.full_name',
  ],
  ['GitHub App Actions workflows', 'name', '_parent.full_name'],
  [
    'GitHub App Dependabot alerts (per repo)',
    'security_advisory.summary',
    "dependency.package.name & ' - ' & security_vulnerability.severity",
  ],
  ['GitHub App collaborators (per repo)', 'login', '_parent.full_name'],
  ['GitHub App markdown files (per repo)', 'path', 'repository.full_name'],
  ['GitHub App YAML files (per repo)', 'path', 'repository.full_name'],
  ['GitLab projects', 'name', 'path_with_namespace'],
  ['GitLab groups', 'name', 'full_path'],
  [
    'GitLab merge requests',
    'title',
    'references.full ? references.full : _parent.path_with_namespace',
  ],
  [
    'GitLab issues',
    'title',
    'references.full ? references.full : _parent.path_with_namespace',
  ],
  [
    'GitLab group members',
    'name ? name : username',
    "_parent.full_path & ' - ' & access_level",
  ],
  [
    'GitLab project members',
    'name ? name : username',
    "_parent.path_with_namespace & ' - ' & access_level",
  ],
  ['GitLab tags', 'name', '_parent.path_with_namespace'],
  ['GitLab releases', 'name ? name : tag_name', '_parent.path_with_namespace'],
  ['GitLab pipelines', 'ref', "status & ' - ' & _parent.path_with_namespace"],
  [
    'GitLab environments',
    'name',
    "state & ' - ' & _parent.path_with_namespace",
  ],
  ['GitLab deployments', 'environment.name', "status & ' - ' & ref"],
  [
    'CircleCI pipelines (all organizations)',
    "'Pipeline #' & $string(number)",
    "state & ' - ' & _parent.name",
  ],
  [
    'CircleCI workflows (all organizations)',
    'name',
    "status & ' - ' & _parent._parent.name",
  ],
  ['CircleCI jobs (all organizations)', 'name', "status & ' - ' & type"],
  ['PagerDuty incidents', 'title ? title : summary', 'status'],
  ['PagerDuty services', 'name', 'status'],
  ['PagerDuty users', 'name', 'email'],
  ['PagerDuty teams', 'name', 'description'],
  ['PagerDuty escalation policies', 'name', 'summary ? summary : description'],
  ['PagerDuty schedules', 'name', 'time_zone'],
  [
    'PagerDuty on-calls',
    'user.summary',
    "schedule.summary & ' (L' & $string(escalation_level) & ')'",
  ],
  [
    'Snyk organizations (all organizations)',
    'attributes.name',
    'attributes.slug',
  ],
  [
    'Snyk memberships (all organizations)',
    'attributes.role',
    'relationships.user.data.id',
  ],
  [
    'Snyk targets (all organizations)',
    'attributes.display_name',
    'attributes.url',
  ],
  ['Snyk projects (all organizations)', 'attributes.name', 'attributes.type'],
  ['Shortcut iterations', 'name', 'status'],
  ['Shortcut epics', 'name', 'state'],
  ['Shortcut members', 'profile.name', 'profile.email_address'],
  ['Shortcut groups', 'name', 'mention_name'],
  ['Shortcut projects', 'name', 'description'],
  ['LaunchDarkly projects', 'name', 'key'],
  ['LaunchDarkly feature flags', 'name', 'key'],
  ['LaunchDarkly environments', 'name', 'key'],
  ['LaunchDarkly members', 'email', 'role'],
  ['LaunchDarkly teams', 'name', 'key'],
  ['LaunchDarkly audit log', 'title', 'kind'],
  ['LaunchDarkly metrics', 'name', 'kind'],
  ['Humanitec applications (organization discovery)', 'name', '_parent.id'],
  ['Humanitec environments (organization discovery)', 'name', 'type'],
  ['Entra ID users', 'displayName', 'mail ? mail : userPrincipalName'],
  ['Entra ID groups', 'displayName', 'mail ? mail : visibility'],
  ['Entra ID applications', 'displayName', 'signInAudience'],
  ['Entra ID service principals', 'displayName', 'servicePrincipalType'],
  ['Entra ID agent identities', 'displayName', 'appId'],
  ['Entra ID devices', 'displayName', 'operatingSystem'],
  ['Entra ID directory roles', 'displayName', 'description'],
  ['Entra ID domains', 'id', 'authenticationType'],
  [
    'Microsoft Teams teams',
    'displayName',
    'description ? description : visibility',
  ],
  [
    'Microsoft Teams channels (per team)',
    'displayName',
    "_parent.displayName & ' - ' & membershipType",
  ],
  [
    'Microsoft Teams members (per team)',
    'displayName',
    "_parent.displayName & ' - ' & (email ? email : userId)",
  ],
  [
    'Pulumi stacks (all organizations)',
    "projectName & '/' & stackName",
    '_parent.name',
  ],
  [
    'Pulumi stack deployments (all organizations)',
    "pulumiOperation & ' v' & $string(version)",
    'status',
  ],
  ['Terraform Cloud organizations', 'attributes.name', 'attributes.email'],
  [
    'Terraform Cloud workspaces (all organizations)',
    'attributes.name',
    '_parent.attributes.name',
  ],
  [
    'Terraform Cloud runs (all organizations)',
    'attributes.message ? attributes.message : id',
    'attributes.status',
  ],
  ['Azure subscriptions', 'displayName', 'subscriptionId'],
  ['Azure resource groups', 'name', '_parent.displayName'],
  ['Azure resources', 'name', 'type'],
  ['Azure virtual machines', 'name', 'resourceGroup'],
  ['Azure managed clusters', 'name', 'resourceGroup'],
  ['Azure storage accounts', 'name', 'resourceGroup'],
  ['Azure key vaults', 'name', 'resourceGroup'],
  ['Azure DevOps projects', 'name', 'state'],
  ['Azure DevOps repositories', 'name', '_parent.name'],
  ['Azure DevOps pipelines', 'name', '_parent.name'],
  ['Azure DevOps pull requests', 'title', 'repository.name'],
  ['Azure DevOps teams', 'name', 'projectName'],
  ['Azure DevOps service connections', 'name', 'type'],
  ['Datadog monitors', 'name', 'type'],
  ['Datadog dashboards', 'title', 'layout_type'],
  ['Datadog SLOs', 'name', 'type'],
  [
    'Datadog service definitions',
    'attributes.schema.dd-service',
    'attributes.schema.description',
  ],
  ['Datadog teams', 'attributes.name', 'attributes.handle'],
  ['Datadog team memberships', 'user_id', 'attributes.role'],
  ['Dynatrace hosts', 'displayName', 'type'],
  ['Dynatrace services', 'displayName', 'type'],
  ['Dynatrace problems (last 30 days)', 'title', 'severityLevel'],
  ['Dynatrace synthetic monitors', 'name', 'type'],
  ['Dynatrace synthetic monitor details', 'name', 'type'],
  ['Sentry organizations (all organizations)', 'name', 'slug'],
  ['Sentry teams (all organizations)', 'name', 'slug'],
  ['Sentry projects (all organizations)', 'name', 'slug'],
  ['Sentry members (all organizations)', 'name', 'email'],
  ['Sentry issues (per project)', 'title', 'shortId'],
  ['Slack channels', 'name', 'purpose.value ? purpose.value : topic.value'],
  [
    'Slack users',
    'real_name ? real_name : profile.display_name',
    'profile.email ? profile.email : name',
  ],
  ['Slack user groups', 'name', 'handle'],
  ['Slack channel members (per channel)', 'value', '_parent.name'],
  ['incident.io incidents', 'name', 'reference'],
  ['incident.io severities', 'name', '$string(rank)'],
  ['incident.io incident roles', 'name', 'role_type'],
  ['incident.io users', 'name', 'email'],
  ['incident.io follow-ups (per incident)', 'title', 'status'],
  ['Google Workspace users', 'name.fullName', 'primaryEmail'],
  ['Google Workspace groups', 'name', 'email'],
  ['Google Workspace group members (per group)', 'email', '_parent.email'],
  ['Google Workspace organizational units', 'name', 'orgUnitPath'],
  [
    'Google Workspace domains',
    'domainName',
    "isPrimary ? 'Primary domain' : 'Domain'",
  ],
  ['Okta users', "profile.firstName & ' ' & profile.lastName", 'profile.email'],
  ['Okta groups', 'profile.name', 'type'],
  [
    'Okta group members',
    "profile.firstName & ' ' & profile.lastName",
    '_parent.profile.name',
  ],
  ['Okta applications', 'label', 'name'],
  ['Bitbucket Cloud workspaces', 'name', 'slug'],
  [
    'Bitbucket Cloud repositories',
    'full_name',
    'project.name ? project.name : _parent.slug',
  ],
  [
    'Bitbucket Cloud pull requests (per repo)',
    'title',
    "_parent.full_name & ' - ' & state",
  ],
  ['Bitbucket Cloud workspace members', 'user.display_name', 'workspace.slug'],
  ['Bitbucket Cloud projects', 'name', "_parent.slug & ':' & key"],
  ['Bitbucket Server projects', 'name', 'key'],
  ['Bitbucket Server repositories', 'name', "project.key & '/' & slug"],
  [
    'Bitbucket Server repositories (per project)',
    'name',
    "project.key & '/' & slug",
  ],
  [
    'Bitbucket Server pull requests (per repo)',
    'title',
    "toRef.repository.project.key & '/' & toRef.repository.slug & ' - ' & state",
  ],
  [
    'Bitbucket Server users',
    'displayName ? displayName : name',
    'emailAddress ? emailAddress : slug',
  ],
  ['Anthropic organization members', 'name', 'email'],
  ['Anthropic workspaces', 'name', 'id'],
  ['Anthropic workspace members', 'workspace_role', 'user_id'],
  ['Anthropic API keys', 'name', 'status'],
  ['Anthropic organization invites', 'email', 'status'],
  ['Cursor team members', 'name', 'email'],
  ['Cursor member spend', 'name', 'email'],
  ['Cursor daily usage (last 7 days)', 'email', 'day'],
  ['Cursor audit logs (last 7 days)', 'event_type', 'user_email'],
  ['OpenAI organization users', 'name', 'email'],
  ['OpenAI projects', 'name', 'status'],
  ['OpenAI project members', 'name', 'role'],
  ['OpenAI project API keys', 'name', 'redacted_value'],
  ['OpenAI project service accounts', 'name', 'role'],
  ['GCP organizations', 'displayName', 'name'],
  ['GCP folders', 'displayName', 'parent'],
  ['GCP projects', 'displayName', 'projectId'],
  ['GCP tag keys (per organization)', 'shortName', 'description'],
  ...AWS_REVIEWED_ENTRIES,
  ['Jira projects', 'name', 'key'],
  ['Jira users', 'displayName', 'emailAddress ? emailAddress : accountType'],
  ['Jira boards', 'name', 'location.projectKey ? location.projectKey : type'],
  ['Jira issues (per project)', 'fields.summary', 'key'],
  ['Jira sprints (per scrum board)', 'name', 'state'],
  ['Linear teams', 'name', 'key'],
  ['Linear users', 'displayName ? displayName : name', 'email'],
  ['Linear projects', 'name', 'status.name'],
  ['Linear issues', 'title', 'identifier'],
  ['Linear issues (per team)', 'title', 'identifier'],
  ['SonarQube projects', 'name', 'key'],
  ['SonarQube issues (per project)', 'message', 'project'],
  ['SonarQube branches (per project)', 'name', '_parent.key'],
  ['SonarQube quality gates', 'name', '$string(isDefault)'],
  ['SonarQube metrics', 'name', 'domain'],
  [
    'Argo CD applications',
    'metadata.name',
    "status.sync.status & ' / ' & status.health.status",
  ],
  [
    'Argo CD projects',
    'metadata.name',
    'spec.description ? spec.description : metadata.namespace',
  ],
  ['Argo CD clusters', 'name ? name : server', 'server'],
  ['Argo CD repositories', 'repo', 'type ? type : connectionState.status'],
  [
    'Argo CD applications (per project)',
    'metadata.name',
    'spec.project ? spec.project : _parent.metadata.name',
  ],
  ['Buildkite organizations', 'name', 'slug'],
  [
    'Buildkite pipelines (all organizations)',
    'name',
    "_parent.name & ' - ' & repository",
  ],
  [
    'Buildkite builds (per pipeline)',
    "message ? message : 'Build #' & $string(number)",
    "branch & ' - ' & state",
  ],
  ['Buildkite teams (all organizations)', 'name', '_parent.name'],
  ['Wiz projects', 'name', 'businessUnit ? businessUnit : description'],
  [
    'Wiz issues',
    'entitySnapshot.name ? entitySnapshot.name : id',
    "severity & ' - ' & status",
  ],
  [
    'Wiz issues enriched',
    'entitySnapshot.name ? entitySnapshot.name : id',
    "severity & ' - ' & status",
  ],
  [
    'Wiz issue threat detection details',
    'threatDetectionDetails.mainDetection.description ? threatDetectionDetails.mainDetection.description : id',
    'type',
  ],
  [
    'Wiz cloud resources',
    'name ? name : graphEntity.name',
    'type ? type : subscriptionExternalId',
  ],
  [
    'Wiz vulnerability findings',
    'name ? name : vulnerabilityExternalId',
    'CVSSSeverity ? CVSSSeverity : vendorSeverity',
  ],
  ['Wiz version control resources', 'id', 'id'],
  [
    'Wiz issues (per project)',
    'entitySnapshot.name ? entitySnapshot.name : id',
    "_parent.name & ' - ' & severity",
  ],
  ['Kubernetes namespaces', 'metadata.name', 'status.phase'],
  [
    'Kubernetes deployments (all namespaces)',
    'metadata.name',
    'metadata.namespace',
  ],
  [
    'Kubernetes services (all namespaces)',
    'metadata.name',
    'metadata.namespace',
  ],
  [
    'Kubernetes ingresses (all namespaces)',
    'metadata.name',
    'metadata.namespace',
  ],
  ['Kubernetes custom resource definitions', 'spec.names.kind', 'spec.group'],
  [
    'Crossplane composite resource definitions',
    'spec.names.kind',
    'spec.group',
  ],
  ['Crossplane compositions', 'metadata.name', 'spec.compositeTypeRef.kind'],
  [
    'Crossplane composition revisions',
    'metadata.name',
    '$string(spec.revision)',
  ],
  ['Crossplane providers', 'metadata.name', 'spec.package'],
  ['Crossplane provider revisions', 'metadata.name', 'spec.package'],
  ['Crossplane functions', 'metadata.name', 'spec.package'],
  ['Crossplane function revisions', 'metadata.name', 'spec.package'],
  ['Crossplane configurations', 'metadata.name', 'spec.package'],
  ['Crossplane configuration revisions', 'metadata.name', 'spec.package'],
  ['Crossplane deployment runtime configs', 'metadata.name', 'kind'],
  ['Crossplane environment configs', 'metadata.name', 'kind'],
  ['Crossplane managed resource definitions', 'spec.names.kind', 'spec.group'],
  ['Crossplane usages', 'metadata.name', 'metadata.namespace'],
  ['Crossplane image configs', 'metadata.name', 'kind'],
  ['Crossplane claims', 'metadata.name', 'metadata.namespace'],
  ['Crossplane composite resources', 'metadata.name', 'kind'],
  ['Crossplane managed resources', 'metadata.name', 'kind'],
  ['Crossplane provider configs', 'metadata.name', 'kind'],
];

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const reviewedSelectorsBySeedName = Object.fromEntries(
  reviewedEntries.map(([name, titleSelector, subtitleSelector]) => [
    name,
    {
      presentation_title_selector: titleSelector,
      presentation_subtitle_selector: subtitleSelector,
    },
  ]),
);

for (const [name, selectors] of Object.entries({
  ...reviewedSelectorsBySeedName,
})) {
  if (name.startsWith('GitHub App ')) {
    reviewedSelectorsBySeedName[
      name.replace('GitHub App ', 'GitHub Enterprise App ')
    ] = selectors;
  } else if (name.startsWith('GitHub ')) {
    reviewedSelectorsBySeedName[name.replace('GitHub ', 'GitHub Enterprise ')] =
      selectors;
  }
}

const reviewedSelectorsBySeedSlug = Object.fromEntries(
  Object.entries(reviewedSelectorsBySeedName).map(([name, selectors]) => [
    slugify(name),
    selectors,
  ]),
);

function unique(paths) {
  return [...new Set(paths)];
}

function selectorFromPaths(paths) {
  return unique(paths).reduceRight(
    (fallback, path) => `${path} ? ${path} : ${fallback}`,
    'null',
  );
}

function genericSelectorsForSeed(seed) {
  const lowerName = seed.name.toLowerCase();
  const titlePaths = [...DEFAULT_TITLE_PATHS];
  const subtitlePaths = [...DEFAULT_SUBTITLE_PATHS];
  const imagePaths = [...DEFAULT_IMAGE_PATHS];

  if (lowerName.includes('jira issues')) {
    titlePaths.unshift('fields.summary');
    subtitlePaths.unshift('key');
  }
  if (lowerName === 'jira projects') {
    titlePaths.unshift('name');
    subtitlePaths.unshift('key');
  }
  if (lowerName === 'jira users') {
    titlePaths.unshift('displayName');
    subtitlePaths.unshift('emailAddress');
  }
  if (lowerName.includes('linear issues')) {
    titlePaths.unshift('title');
    subtitlePaths.unshift('identifier');
  }
  if (lowerName === 'slack users') {
    titlePaths.unshift('real_name');
    subtitlePaths.unshift('profile.email');
    imagePaths.unshift('profile.image_512');
  }
  if (lowerName.includes('slack channel members')) {
    titlePaths.unshift('value');
    subtitlePaths.unshift('_parent.name');
  }
  if (lowerName.includes('argo cd repositories')) {
    titlePaths.unshift('repo');
  }
  if (lowerName.includes('kubernetes')) {
    titlePaths.unshift('metadata.name');
    subtitlePaths.unshift('metadata.namespace');
  }
  if (lowerName === 'google workspace users') {
    titlePaths.unshift('name.fullName', 'primaryEmail');
    subtitlePaths.unshift('primaryEmail');
  }
  if (
    lowerName.includes('yaml files') ||
    lowerName.includes('markdown files') ||
    lowerName.includes('catalog-info')
  ) {
    titlePaths.unshift('path');
    subtitlePaths.unshift('repository.full_name', '_parent.full_name');
  }

  return {
    presentation_title_selector: selectorFromPaths(titlePaths),
    presentation_subtitle_selector: selectorFromPaths(subtitlePaths),
    presentation_image_selector: selectorFromPaths(imagePaths),
  };
}

function getReviewedPresentationSelectorsForWorkflow(workflow) {
  if (!workflow || typeof workflow.name !== 'string') {
    return undefined;
  }

  const byName = reviewedSelectorsBySeedName[workflow.name];
  if (byName) {
    return byName;
  }

  const candidateSlug =
    typeof workflow.slug === 'string' && workflow.slug.length > 0
      ? workflow.slug
      : slugify(workflow.name);
  return reviewedSelectorsBySeedSlug[candidateSlug];
}

function selectorsForSeed(seed) {
  const genericSelectors = genericSelectorsForSeed(seed);
  const reviewedSelectors = getReviewedPresentationSelectorsForWorkflow(seed);
  if (!reviewedSelectors) {
    return genericSelectors;
  }
  return {
    ...genericSelectors,
    ...reviewedSelectors,
  };
}

function withPresentationSelectors(seed) {
  return {
    ...seed,
    build(integrationId) {
      const built = seed.build(integrationId);
      const selectors = selectorsForSeed(seed);
      return {
        ...built,
        nodes: built.nodes.map(node => {
          if (node.type !== 'sink-datastore') {
            return node;
          }
          const config =
            node.data && typeof node.data === 'object' && node.data.config
              ? node.data.config
              : {};
          return {
            ...node,
            data: {
              ...node.data,
              config: {
                ...selectors,
                ...config,
              },
            },
          };
        }),
      };
    },
  };
}

function applyPresentationSelectorsToSeeds(seeds) {
  return seeds.map(withPresentationSelectors);
}

module.exports = {
  applyPresentationSelectorsToSeeds,
  getReviewedPresentationSelectorsForWorkflow,
};
