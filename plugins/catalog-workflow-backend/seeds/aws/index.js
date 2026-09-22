const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

const schedule = () =>
  scheduleTriggerNode(
    'trigger',
    { x: 0, y: 0 },
    { frequencyValue: 24, frequencyUnit: 'hours' },
  );

const awsServiceConfig = (integrationId, config) => ({
  integrationId,
  backendType: 'aws',
  mode: 'service-api',
  accountSelection: { mode: 'all' },
  ...config,
});

// Every item flowing into a chained node - whether from the head list step or
// from a prior chain step's own service-api call - carries a top-level `_aws`
// (stamped by AwsBackend.requestServiceApiPages). Templating from it scopes
// each per-item detail/describe call to the single account+region that item
// actually came from, instead of re-fanning across every configured account.
const awsChainedServiceConfig = (integrationId, config) => ({
  integrationId,
  backendType: 'aws',
  mode: 'service-api',
  accountIds: ['{{_aws.accountId}}'],
  regions: ['{{_aws.region}}'],
  ...config,
});

const awsCloudControlConfig = (integrationId, config) => ({
  integrationId,
  backendType: 'aws',
  mode: 'cloud-control',
  accountSelection: { mode: 'all' },
  ...config,
});

function serviceApiSeed(definition) {
  return {
    name: definition.name,
    description: definition.description,
    integrationSlug: 'aws',
    build(integrationId) {
      return {
        nodes: [
          schedule(),
          integrationSourceNode(
            'list-resources',
            { x: 280, y: 0 },
            awsServiceConfig(integrationId, {
              service: definition.service,
              operation: definition.operation,
              ...definition.sourceConfig,
            }),
            definition.sourceLabel,
          ),
          datastoreSinkNode(
            'sink',
            { x: 560, y: 0 },
            {
              id_selector: definition.idSelector,
              items_selector: definition.itemsSelector ?? '$',
            },
          ),
        ],
        edges: [
          edge('e1', 'trigger', 'list-resources'),
          edge('e2', 'list-resources', 'sink'),
        ],
        viewport: { x: 0, y: 0, zoom: 0.85 },
      };
    },
  };
}

function cloudControlSeed(definition) {
  return {
    name: definition.name,
    description: definition.description,
    integrationSlug: 'aws',
    build(integrationId) {
      return {
        nodes: [
          schedule(),
          integrationSourceNode(
            'list-resources',
            { x: 280, y: 0 },
            awsCloudControlConfig(integrationId, {
              resourceType: definition.resourceType,
              ...definition.sourceConfig,
            }),
            definition.sourceLabel,
          ),
          datastoreSinkNode(
            'sink',
            { x: 560, y: 0 },
            {
              id_selector: definition.idSelector,
              items_selector: '$',
            },
          ),
        ],
        edges: [
          edge('e1', 'trigger', 'list-resources'),
          edge('e2', 'list-resources', 'sink'),
        ],
        viewport: { x: 0, y: 0, zoom: 0.85 },
      };
    },
  };
}

function chainedSeed(definition) {
  return {
    name: definition.name,
    description: definition.description,
    integrationSlug: 'aws',
    build(integrationId) {
      const nodes = [
        schedule(),
        integrationSourceNode(
          definition.source.id,
          { x: 280, y: 0 },
          awsServiceConfig(integrationId, definition.source.config),
          definition.source.label,
        ),
        ...definition.chain.map((node, index) =>
          chainedSourceNode(
            node.id,
            { x: 560 + index * 280, y: 0 },
            awsChainedServiceConfig(integrationId, node.config),
            node.label,
          ),
        ),
        datastoreSinkNode(
          'sink',
          { x: 560 + definition.chain.length * 280, y: 0 },
          {
            id_selector: definition.idSelector,
            items_selector: definition.itemsSelector ?? '$',
          },
        ),
      ];
      const edges = [
        edge('e1', 'trigger', definition.source.id),
        ...definition.chain.map((node, index) =>
          edge(
            `e${index + 2}`,
            index === 0 ? definition.source.id : definition.chain[index - 1].id,
            node.id,
          ),
        ),
        edge(
          `e${definition.chain.length + 2}`,
          definition.chain[definition.chain.length - 1].id,
          'sink',
        ),
      ];
      return {
        nodes,
        edges,
        viewport: { x: 0, y: 0, zoom: 0.85 },
      };
    },
  };
}

function configuredAccountsSeed() {
  return {
    name: 'AWS accounts',
    formerNames: ['AWS Organizations accounts', 'AWS Organisation accounts'],
    description:
      'List AWS accounts from Organizations and manually configured profiles.',
    integrationSlug: 'aws',
    build(integrationId) {
      return {
        nodes: [
          schedule(),
          integrationSourceNode(
            'list-accounts',
            { x: 280, y: 0 },
            {
              integrationId,
              backendType: 'aws',
              mode: 'configured-accounts',
            },
            'List accounts',
          ),
          datastoreSinkNode(
            'sink',
            { x: 560, y: 0 },
            {
              id_selector: 'Id',
              items_selector: '$',
            },
          ),
        ],
        edges: [
          edge('e1', 'trigger', 'list-accounts'),
          edge('e2', 'list-accounts', 'sink'),
        ],
        viewport: { x: 0, y: 0, zoom: 0.85 },
      };
    },
  };
}

const serviceApiSeeds = [
  [
    'AWS ACM certificates',
    'List ACM certificates across AWS accounts.',
    'acm',
    'ListCertificates',
    'CertificateArn',
  ],
  [
    'AWS API Gateway HTTP APIs',
    'List API Gateway HTTP APIs across AWS accounts.',
    'apigateway',
    'GetApis',
    'ApiId',
  ],
  [
    'AWS AppConfig applications',
    'List AppConfig applications across AWS accounts.',
    'appconfig',
    'ListApplications',
    'Id',
  ],
  [
    'AWS AppSync GraphQL APIs',
    'List AppSync GraphQL APIs across AWS accounts.',
    'appsync',
    'ListGraphqlApis',
    'apiId',
  ],
  [
    'AWS Auto Scaling groups',
    'List EC2 Auto Scaling groups across AWS accounts.',
    'autoscaling',
    'DescribeAutoScalingGroups',
    'AutoScalingGroupARN',
  ],
  [
    'AWS Backup plans',
    'List AWS Backup plans across AWS accounts.',
    'backup',
    'ListBackupPlans',
    'BackupPlanArn',
  ],
  [
    'AWS Backup vaults',
    'List AWS Backup vaults across AWS accounts.',
    'backup',
    'ListBackupVaults',
    'BackupVaultArn',
  ],
  [
    'AWS Batch compute environments',
    'List AWS Batch compute environments across AWS accounts.',
    'batch',
    'DescribeComputeEnvironments',
    'computeEnvironmentArn',
  ],
  [
    'AWS Batch job queues',
    'List AWS Batch job queues across AWS accounts.',
    'batch',
    'DescribeJobQueues',
    'jobQueueArn',
  ],
  [
    'AWS Bedrock foundation models',
    'List Amazon Bedrock foundation models visible to AWS accounts.',
    'bedrock',
    'ListFoundationModels',
    'modelArn ? modelArn : modelId',
  ],
  [
    'AWS CloudFormation stacks',
    'List CloudFormation stacks across AWS accounts.',
    'cloudformation',
    'DescribeStacks',
    'StackId',
  ],
  [
    'AWS CloudFront distributions',
    'List CloudFront distributions across AWS accounts.',
    'cloudfront',
    'ListDistributions',
    'ARN ? ARN : Id',
  ],
  [
    'AWS CloudTrail trails',
    'List CloudTrail trails across AWS accounts.',
    'cloudtrail',
    'DescribeTrails',
    'TrailARN ? TrailARN : Name',
  ],
  [
    'AWS CloudWatch log groups',
    'List CloudWatch log groups across AWS accounts.',
    'logs',
    'DescribeLogGroups',
    "_aws.accountId & ':' & _aws.region & ':' & logGroupName",
  ],
  [
    'AWS CodeArtifact domains',
    'List CodeArtifact domains across AWS accounts.',
    'codeartifact',
    'ListDomains',
    "_aws.accountId & ':' & _aws.region & ':' & name",
  ],
  [
    'AWS CodeArtifact repositories',
    'List CodeArtifact repositories across AWS accounts.',
    'codeartifact',
    'ListRepositories',
    "domainName & ':' & name",
  ],
  [
    'AWS CodeBuild projects',
    'List CodeBuild projects across AWS accounts.',
    'codebuild',
    'ListProjects',
    "_aws.accountId & ':' & _aws.region & ':' & value",
  ],
  [
    'AWS CodePipeline pipelines',
    'List CodePipeline pipelines across AWS accounts.',
    'codepipeline',
    'ListPipelines',
    "_aws.accountId & ':' & _aws.region & ':' & name",
  ],
  [
    'AWS Cognito user pools',
    'List Cognito user pools across AWS accounts.',
    'cognito-idp',
    'ListUserPools',
    'Id',
  ],
  [
    'AWS DynamoDB backups',
    'List DynamoDB backups across AWS accounts.',
    'dynamodb',
    'ListBackups',
    'BackupArn',
  ],
  [
    'AWS EC2 Elastic IPs',
    'List EC2 Elastic IP addresses across AWS accounts.',
    'ec2',
    'DescribeAddresses',
    'allocationId ? allocationId : publicIp',
  ],
  [
    'AWS EC2 instances',
    'List EC2 instances across AWS accounts.',
    'ec2',
    'DescribeInstances',
    'instanceId',
  ],
  [
    'AWS EC2 internet gateways',
    'List EC2 internet gateways across AWS accounts.',
    'ec2',
    'DescribeInternetGateways',
    'internetGatewayId',
  ],
  [
    'AWS EC2 NAT gateways',
    'List EC2 NAT gateways across AWS accounts.',
    'ec2',
    'DescribeNatGateways',
    'natGatewayId',
  ],
  [
    'AWS EC2 security groups',
    'List EC2 security groups across AWS accounts.',
    'ec2',
    'DescribeSecurityGroups',
    'groupId',
  ],
  [
    'AWS EC2 subnets',
    'List EC2 subnets across AWS accounts.',
    'ec2',
    'DescribeSubnets',
    'subnetId',
  ],
  [
    'AWS EC2 volumes',
    'List EC2 volumes across AWS accounts.',
    'ec2',
    'DescribeVolumes',
    'volumeId',
  ],
  [
    'AWS EC2 VPCs',
    'List EC2 VPCs across AWS accounts.',
    'ec2',
    'DescribeVpcs',
    'vpcId',
  ],
  [
    'AWS ECR repositories',
    'List ECR repositories across AWS accounts.',
    'ecr',
    'DescribeRepositories',
    'repositoryArn',
  ],
  [
    'AWS EFS file systems',
    'List EFS file systems across AWS accounts.',
    'elasticfilesystem',
    'DescribeFileSystems',
    'FileSystemArn',
  ],
  [
    'AWS ElastiCache clusters',
    'List ElastiCache clusters across AWS accounts.',
    'elasticache',
    'DescribeCacheClusters',
    'CacheClusterId',
  ],
  [
    'AWS ElastiCache replication groups',
    'List ElastiCache replication groups across AWS accounts.',
    'elasticache',
    'DescribeReplicationGroups',
    'ReplicationGroupId',
  ],
  [
    'AWS ELBv2 load balancers',
    'List ELBv2 load balancers across AWS accounts.',
    'elasticloadbalancing',
    'DescribeLoadBalancers',
    'LoadBalancerArn',
  ],
  [
    'AWS ELBv2 target groups',
    'List ELBv2 target groups across AWS accounts.',
    'elasticloadbalancing',
    'DescribeTargetGroups',
    'TargetGroupArn',
  ],
  [
    'AWS EventBridge buses',
    'List EventBridge buses across AWS accounts.',
    'events',
    'ListEventBuses',
    'Arn',
  ],
  [
    'AWS EventBridge rules',
    'List EventBridge rules across AWS accounts.',
    'events',
    'ListRules',
    'Arn',
  ],
  [
    'AWS Glue crawlers',
    'List Glue crawlers across AWS accounts.',
    'glue',
    'GetCrawlers',
    "_aws.accountId & ':' & _aws.region & ':' & Name",
  ],
  [
    'AWS Glue databases',
    'List Glue databases across AWS accounts.',
    'glue',
    'GetDatabases',
    "_aws.accountId & ':' & _aws.region & ':' & Name",
  ],
  [
    'AWS Glue jobs',
    'List Glue jobs across AWS accounts.',
    'glue',
    'GetJobs',
    "_aws.accountId & ':' & _aws.region & ':' & Name",
  ],
  [
    'AWS GuardDuty detectors',
    'List GuardDuty detectors across AWS accounts.',
    'guardduty',
    'ListDetectors',
    "_aws.accountId & ':' & _aws.region & ':' & value",
  ],
  [
    'AWS IAM groups',
    'List IAM groups across AWS accounts.',
    'iam',
    'ListGroups',
    'Arn',
  ],
  [
    'AWS IAM instance profiles',
    'List IAM instance profiles across AWS accounts.',
    'iam',
    'ListInstanceProfiles',
    'Arn',
  ],
  [
    'AWS IAM policies',
    'List IAM policies across AWS accounts.',
    'iam',
    'ListPolicies',
    'Arn',
  ],
  [
    'AWS IAM roles',
    'List IAM roles across AWS accounts.',
    'iam',
    'ListRoles',
    'Arn',
  ],
  [
    'AWS IAM users',
    'List IAM users across AWS accounts.',
    'iam',
    'ListUsers',
    'Arn',
  ],
  [
    'AWS KMS aliases',
    'List KMS aliases across AWS accounts.',
    'kms',
    'ListAliases',
    'AliasArn ? AliasArn : AliasName',
  ],
  [
    'AWS KMS keys',
    'List KMS keys across AWS accounts.',
    'kms',
    'ListKeys',
    'KeyArn ? KeyArn : KeyId',
  ],
  [
    'AWS Lambda event source mappings',
    'List Lambda event source mappings across AWS accounts.',
    'lambda',
    'ListEventSourceMappings',
    'UUID',
  ],
  [
    'AWS Lambda functions',
    'List Lambda functions across AWS accounts.',
    'lambda',
    'ListFunctions',
    'FunctionArn',
  ],
  [
    'AWS Lambda layers',
    'List Lambda layers across AWS accounts.',
    'lambda',
    'ListLayers',
    'LayerArn',
  ],
  [
    'AWS RDS DB clusters',
    'List RDS DB clusters across AWS accounts.',
    'rds',
    'DescribeDBClusters',
    'DBClusterArn',
  ],
  [
    'AWS RDS DB instances',
    'List RDS DB instances across AWS accounts.',
    'rds',
    'DescribeDBInstances',
    'DBInstanceArn',
  ],
  [
    'AWS RDS DB snapshots',
    'List RDS DB snapshots across AWS accounts.',
    'rds',
    'DescribeDBSnapshots',
    'DBSnapshotArn',
  ],
  [
    'AWS Redshift clusters',
    'List Redshift clusters across AWS accounts.',
    'redshift',
    'DescribeClusters',
    'ClusterNamespaceArn ? ClusterNamespaceArn : ClusterIdentifier',
  ],
  [
    'AWS Route53 hosted zones',
    'List Route 53 hosted zones across AWS accounts.',
    'route53',
    'ListHostedZones',
    'Id',
  ],
  [
    'AWS S3 buckets',
    'List S3 buckets across AWS accounts.',
    's3',
    'ListBuckets',
    'Name',
  ],
  [
    'AWS Secrets Manager secrets',
    'List Secrets Manager secrets across AWS accounts.',
    'secretsmanager',
    'ListSecrets',
    'ARN',
  ],
  [
    'AWS SNS topics',
    'List SNS topics across AWS accounts.',
    'sns',
    'ListTopics',
    'TopicArn',
  ],
  [
    'AWS SSM documents',
    'List Systems Manager documents across AWS accounts.',
    'ssm',
    'ListDocuments',
    "_aws.accountId & ':' & _aws.region & ':' & Name",
  ],
  [
    'AWS SSM managed instances',
    'List Systems Manager managed instances across AWS accounts.',
    'ssm',
    'DescribeInstanceInformation',
    'InstanceId',
  ],
  [
    'AWS SSM parameters',
    'List Systems Manager parameters across AWS accounts.',
    'ssm',
    'DescribeParameters',
    'Name',
  ],
  [
    'AWS Step Functions activities',
    'List Step Functions activities across AWS accounts.',
    'states',
    'ListActivities',
    'activityArn',
  ],
  [
    'AWS Step Functions state machines',
    'List Step Functions state machines across AWS accounts.',
    'states',
    'ListStateMachines',
    'stateMachineArn',
  ],
  [
    'AWS tagged resources',
    'List AWS resources with tags using the Resource Groups Tagging API.',
    'tagging',
    'GetResources',
    'ResourceARN',
  ],
  [
    'AWS WAFv2 Web ACLs',
    'List regional WAFv2 Web ACLs across AWS accounts.',
    'wafv2',
    'ListWebACLs',
    'ARN',
  ],
].map(([name, description, service, operation, idSelector]) =>
  serviceApiSeed({
    name,
    description,
    service,
    operation,
    idSelector,
    sourceLabel: operation,
  }),
);

const chainedSeeds = [
  chainedSeed({
    name: 'AWS EKS clusters',
    description: 'List and describe EKS clusters across AWS accounts.',
    source: {
      id: 'list-clusters',
      label: 'List clusters',
      config: { service: 'eks', operation: 'ListClusters' },
    },
    chain: [
      {
        id: 'describe-cluster',
        label: 'Describe cluster',
        config: {
          service: 'eks',
          operation: 'DescribeCluster',
          path: '/clusters/{{value}}',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector: '$string(_parent.value) & ":" & arn',
  }),
  chainedSeed({
    name: 'AWS EKS node groups',
    description: 'List EKS node groups per cluster across AWS accounts.',
    source: {
      id: 'list-clusters',
      label: 'List clusters',
      config: { service: 'eks', operation: 'ListClusters' },
    },
    chain: [
      {
        id: 'describe-cluster',
        label: 'Describe cluster',
        config: {
          service: 'eks',
          operation: 'DescribeCluster',
          path: '/clusters/{{value}}',
          resultMode: 'flatten',
        },
      },
      {
        id: 'list-nodegroups',
        label: 'List node groups',
        config: {
          service: 'eks',
          operation: 'ListNodegroups',
          path: '/clusters/{{name}}/node-groups',
          resultMode: 'flatten',
        },
      },
      {
        id: 'describe-nodegroup',
        label: 'Describe node group',
        config: {
          service: 'eks',
          operation: 'DescribeNodegroup',
          path: '/clusters/{{_parent.name}}/node-groups/{{value}}',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector: '$string(_parent._parent.name) & ":" & nodegroupName',
  }),
  chainedSeed({
    name: 'AWS DynamoDB tables',
    description: 'List and describe DynamoDB tables across AWS accounts.',
    source: {
      id: 'list-tables',
      label: 'List tables',
      config: { service: 'dynamodb', operation: 'ListTables' },
    },
    chain: [
      {
        id: 'describe-table',
        label: 'Describe table',
        config: {
          service: 'dynamodb',
          operation: 'DescribeTable',
          body: '{"TableName":"{{value}}"}',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector: '$string(_parent.value) & ":" & TableArn',
  }),
  chainedSeed({
    name: 'AWS OpenSearch domains',
    description: 'List and describe OpenSearch domains across AWS accounts.',
    source: {
      id: 'list-domains',
      label: 'List domains',
      config: { service: 'es', operation: 'ListDomainNames' },
    },
    chain: [
      {
        id: 'describe-domain',
        label: 'Describe domain',
        config: {
          service: 'es',
          operation: 'DescribeDomain',
          path: '/2021-01-01/opensearch/domain/{{DomainName}}',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector: '$string(_parent.DomainName) & ":" & ARN',
  }),
  chainedSeed({
    name: 'AWS SQS queues',
    description:
      'List SQS queues and fetch queue attributes across AWS accounts.',
    source: {
      id: 'list-queues',
      label: 'List queues',
      config: { service: 'sqs', operation: 'ListQueues' },
    },
    chain: [
      {
        id: 'get-queue-attributes',
        label: 'Get queue attributes',
        config: {
          service: 'sqs',
          operation: 'GetQueueAttributes',
          path: '/?Action=GetQueueAttributes&Version=2012-11-05&AttributeName=All&QueueUrl={{value}}',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector: '$string(_parent.value) & ":" & QueueArn',
  }),
  chainedSeed({
    name: 'AWS SNS topic attributes',
    description:
      'List SNS topics and fetch topic attributes across AWS accounts.',
    source: {
      id: 'list-topics',
      label: 'List topics',
      config: { service: 'sns', operation: 'ListTopics' },
    },
    chain: [
      {
        id: 'get-topic-attributes',
        label: 'Get topic attributes',
        config: {
          service: 'sns',
          operation: 'GetTopicAttributes',
          path: '/?Action=GetTopicAttributes&Version=2010-03-31&TopicArn={{TopicArn}}',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector: '$string(_parent.TopicArn) & ":" & TopicArn',
  }),
  chainedSeed({
    name: 'AWS ECS clusters',
    description: 'List and describe ECS clusters across AWS accounts.',
    source: {
      id: 'list-clusters',
      label: 'List clusters',
      config: { service: 'ecs', operation: 'ListClusters' },
    },
    chain: [
      {
        id: 'describe-cluster',
        label: 'Describe cluster',
        config: {
          service: 'ecs',
          operation: 'DescribeClusters',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector: '$string(_parent.value) & ":" & clusterArn',
  }),
  chainedSeed({
    name: 'AWS ECS services',
    description:
      'List ECS services per cluster and describe them across AWS accounts.',
    source: {
      id: 'list-clusters',
      label: 'List clusters',
      config: { service: 'ecs', operation: 'ListClusters' },
    },
    chain: [
      {
        id: 'list-services',
        label: 'List services',
        config: {
          service: 'ecs',
          operation: 'ListServices',
          body: '{"cluster":"{{value}}"}',
          resultMode: 'flatten',
        },
      },
      {
        id: 'describe-service',
        label: 'Describe service',
        config: {
          service: 'ecs',
          operation: 'DescribeServices',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector: '$string(_parent._parent.value) & ":" & serviceArn',
  }),
  chainedSeed({
    name: 'AWS ECS task definitions',
    description: 'List and describe ECS task definitions across AWS accounts.',
    source: {
      id: 'list-task-definitions',
      label: 'List task definitions',
      config: { service: 'ecs', operation: 'ListTaskDefinitions' },
    },
    chain: [
      {
        id: 'describe-task-definition',
        label: 'Describe task definition',
        config: {
          service: 'ecs',
          operation: 'DescribeTaskDefinition',
          resultMode: 'flatten',
        },
      },
    ],
    idSelector:
      '$string(_parent.value) & ":" & taskDefinition.taskDefinitionArn',
  }),
];

const cloudControlSeeds = [
  cloudControlSeed({
    name: 'AWS App Runner services',
    description:
      'List App Runner services through AWS Cloud Control across AWS accounts.',
    resourceType: 'AWS::AppRunner::Service',
    idSelector: 'properties.ServiceArn ? properties.ServiceArn : identifier',
    sourceLabel: 'List App Runner services',
  }),
];

module.exports = [
  configuredAccountsSeed(),
  ...serviceApiSeeds,
  ...chainedSeeds,
  ...cloudControlSeeds,
];
