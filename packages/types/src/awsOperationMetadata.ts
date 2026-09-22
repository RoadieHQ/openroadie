export type AwsSourceMode =
  | 'cloud-control'
  | 'service-api'
  | 'configured-accounts';

export type AwsServiceHttpMethod = 'GET' | 'POST';

export type AwsServiceProtocol =
  | 'aws-json-1.0'
  | 'aws-json-1.1'
  | 'rest-json'
  | 'rest-xml'
  | 'aws-query'
  | 'ec2-query';

export type AwsOperationPaginationMetadata =
  | {
      type: 'none';
    }
  | {
      type: 'cursor';
      cursorParam: string;
      nextCursorExpression: string;
    }
  | {
      type: 'page';
      pageParam: string;
      perPageParam: string;
      perPage: number;
      startPage?: number;
    }
  | {
      type: 'offset';
      offsetParam: string;
      limitParam: string;
      limit: number;
    }
  | {
      type: 'link';
      perPageParam?: string;
      perPage?: number;
    }
  | {
      type: 'body-link';
      nextLinkExpression: string;
      perPageParam?: string;
      perPage?: number;
    };

export interface AwsOperationMetadata {
  operation: string;
  label: string;
  protocol: AwsServiceProtocol;
  method: AwsServiceHttpMethod;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  hostname?: string;
  signingRegion?: string;
  arrayExpression: string;
  objectIdExpression: string;
  pagination?: AwsOperationPaginationMetadata;
}

export interface AwsServiceMetadata {
  service: string;
  label: string;
  operations: AwsOperationMetadata[];
}

export const AWS_SERVICE_API_METADATA: AwsServiceMetadata[] = [
  {
    service: 'acm',
    label: 'AWS Certificate Manager',
    operations: [
      {
        operation: 'ListCertificates',
        label: 'List certificates',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'CertificateManager.ListCertificates',
        },
        body: '{}',
        arrayExpression: 'CertificateSummaryList',
        objectIdExpression: 'CertificateArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'apigateway',
    label: 'Amazon API Gateway',
    operations: [
      {
        operation: 'GetApis',
        label: 'Get APIs',
        protocol: 'rest-json',
        method: 'GET',
        path: '/v2/apis',
        arrayExpression: 'Items',
        objectIdExpression: 'ApiId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'appconfig',
    label: 'AWS AppConfig',
    operations: [
      {
        operation: 'ListApplications',
        label: 'List applications',
        protocol: 'rest-json',
        method: 'GET',
        path: '/applications',
        arrayExpression: 'Items',
        objectIdExpression: 'Id',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'appsync',
    label: 'AWS AppSync',
    operations: [
      {
        operation: 'ListGraphqlApis',
        label: 'List GraphQL APIs',
        protocol: 'rest-json',
        method: 'GET',
        path: '/v1/apis',
        arrayExpression: 'graphqlApis',
        objectIdExpression: 'apiId',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
  {
    service: 'batch',
    label: 'AWS Batch',
    operations: [
      {
        operation: 'DescribeComputeEnvironments',
        label: 'Describe compute environments',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSBatch.DescribeComputeEnvironments',
        },
        body: '{}',
        arrayExpression: 'computeEnvironments',
        objectIdExpression: 'computeEnvironmentArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
      {
        operation: 'DescribeJobQueues',
        label: 'Describe job queues',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSBatch.DescribeJobQueues',
        },
        body: '{}',
        arrayExpression: 'jobQueues',
        objectIdExpression: 'jobQueueArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
  {
    service: 'bedrock',
    label: 'Amazon Bedrock',
    operations: [
      {
        operation: 'ListFoundationModels',
        label: 'List foundation models',
        protocol: 'rest-json',
        method: 'GET',
        path: '/foundation-models',
        arrayExpression: 'modelSummaries',
        objectIdExpression: 'modelId',
      },
    ],
  },
  {
    service: 'codebuild',
    label: 'AWS CodeBuild',
    operations: [
      {
        operation: 'ListProjects',
        label: 'List projects',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'CodeBuild_20161006.ListProjects',
        },
        body: '{}',
        arrayExpression: 'projects',
        objectIdExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
  {
    service: 'codeartifact',
    label: 'AWS CodeArtifact',
    operations: [
      {
        operation: 'ListDomains',
        label: 'List domains',
        protocol: 'rest-json',
        method: 'GET',
        path: '/v1/domains',
        arrayExpression: 'domains',
        objectIdExpression: 'name',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
      {
        operation: 'ListRepositories',
        label: 'List repositories',
        protocol: 'rest-json',
        method: 'GET',
        path: '/v1/repositories',
        arrayExpression: 'repositories',
        objectIdExpression: 'name',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
  {
    service: 'codepipeline',
    label: 'AWS CodePipeline',
    operations: [
      {
        operation: 'ListPipelines',
        label: 'List pipelines',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'CodePipeline_20150709.ListPipelines',
        },
        body: '{}',
        arrayExpression: 'pipelines',
        objectIdExpression: 'name',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
  {
    service: 'cognito-idp',
    label: 'Amazon Cognito User Pools',
    operations: [
      {
        operation: 'ListUserPools',
        label: 'List user pools',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSCognitoIdentityProviderService.ListUserPools',
        },
        body: '{"MaxResults":60}',
        arrayExpression: 'UserPools',
        objectIdExpression: 'Id',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'dynamodb',
    label: 'Amazon DynamoDB',
    operations: [
      {
        operation: 'ListTables',
        label: 'List tables',
        protocol: 'aws-json-1.0',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.0',
          'x-amz-target': 'DynamoDB_20120810.ListTables',
        },
        body: '{}',
        arrayExpression: 'TableNames',
        objectIdExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'ExclusiveStartTableName',
          nextCursorExpression: 'LastEvaluatedTableName',
        },
      },
      {
        operation: 'DescribeTable',
        label: 'Describe table',
        protocol: 'aws-json-1.0',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.0',
          'x-amz-target': 'DynamoDB_20120810.DescribeTable',
        },
        body: '{"TableName":"{{id}}"}',
        arrayExpression: 'Table',
        objectIdExpression: 'TableArn',
      },
      {
        operation: 'ListBackups',
        label: 'List backups',
        protocol: 'aws-json-1.0',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.0',
          'x-amz-target': 'DynamoDB_20120810.ListBackups',
        },
        body: '{}',
        arrayExpression: 'BackupSummaries',
        objectIdExpression: 'BackupArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'ExclusiveStartBackupArn',
          nextCursorExpression: 'LastEvaluatedBackupArn',
        },
      },
    ],
  },
  {
    service: 'ec2',
    label: 'Amazon EC2',
    operations: [
      {
        operation: 'DescribeInstances',
        label: 'Describe instances',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeInstances&Version=2016-11-15',
        arrayExpression:
          'DescribeInstancesResponse.reservationSet.item.instancesSet.item',
        objectIdExpression: 'instanceId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'DescribeInstancesResponse.nextToken',
        },
      },
      {
        operation: 'DescribeSecurityGroups',
        label: 'Describe security groups',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeSecurityGroups&Version=2016-11-15',
        arrayExpression:
          'DescribeSecurityGroupsResponse.securityGroupInfo.item',
        objectIdExpression: 'groupId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'DescribeSecurityGroupsResponse.nextToken',
        },
      },
      {
        operation: 'DescribeSecurityGroupRules',
        label: 'Describe security group rules',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeSecurityGroupRules&Version=2016-11-15',
        arrayExpression:
          'DescribeSecurityGroupRulesResponse.securityGroupRuleSet.item',
        objectIdExpression: 'securityGroupRuleId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'DescribeSecurityGroupRulesResponse.nextToken',
        },
      },
      {
        operation: 'DescribeSubnets',
        label: 'Describe subnets',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeSubnets&Version=2016-11-15',
        arrayExpression: 'DescribeSubnetsResponse.subnetSet.item',
        objectIdExpression: 'subnetId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'DescribeSubnetsResponse.nextToken',
        },
      },
      {
        operation: 'DescribeVolumes',
        label: 'Describe volumes',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeVolumes&Version=2016-11-15',
        arrayExpression: 'DescribeVolumesResponse.volumeSet.item',
        objectIdExpression: 'volumeId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'DescribeVolumesResponse.nextToken',
        },
      },
      {
        operation: 'DescribeVpcs',
        label: 'Describe VPCs',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeVpcs&Version=2016-11-15',
        arrayExpression: 'DescribeVpcsResponse.vpcSet.item',
        objectIdExpression: 'vpcId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'DescribeVpcsResponse.nextToken',
        },
      },
      {
        operation: 'DescribeAddresses',
        label: 'Describe Elastic IP addresses',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeAddresses&Version=2016-11-15',
        arrayExpression: 'DescribeAddressesResponse.addressesSet.item',
        objectIdExpression: 'allocationId ? allocationId : publicIp',
      },
      {
        operation: 'DescribeNatGateways',
        label: 'Describe NAT gateways',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeNatGateways&Version=2016-11-15',
        arrayExpression: 'DescribeNatGatewaysResponse.natGatewaySet.item',
        objectIdExpression: 'natGatewayId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'DescribeNatGatewaysResponse.nextToken',
        },
      },
      {
        operation: 'DescribeInternetGateways',
        label: 'Describe internet gateways',
        protocol: 'ec2-query',
        method: 'GET',
        path: '/?Action=DescribeInternetGateways&Version=2016-11-15',
        arrayExpression:
          'DescribeInternetGatewaysResponse.internetGatewaySet.item',
        objectIdExpression: 'internetGatewayId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'DescribeInternetGatewaysResponse.nextToken',
        },
      },
    ],
  },
  {
    service: 'ecr',
    label: 'Amazon ECR',
    operations: [
      {
        operation: 'DescribeRepositories',
        label: 'Describe repositories',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target':
            'AmazonEC2ContainerRegistry_V20150921.DescribeRepositories',
        },
        body: '{}',
        arrayExpression: 'repositories',
        objectIdExpression: 'repositoryArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
  {
    service: 'es',
    label: 'Amazon OpenSearch Service',
    operations: [
      {
        operation: 'ListDomainNames',
        label: 'List domain names',
        protocol: 'rest-json',
        method: 'GET',
        path: '/2015-01-01/domain',
        arrayExpression: 'DomainNames',
        objectIdExpression: 'DomainName',
      },
      {
        operation: 'DescribeDomain',
        label: 'Describe domain',
        protocol: 'rest-json',
        method: 'GET',
        path: '/2021-01-01/opensearch/domain/{{id}}',
        arrayExpression: 'DomainStatus',
        objectIdExpression: 'ARN',
      },
    ],
  },
  {
    service: 'ecs',
    label: 'Amazon ECS',
    operations: [
      {
        operation: 'ListClusters',
        label: 'List clusters',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AmazonEC2ContainerServiceV20141113.ListClusters',
        },
        body: '{}',
        arrayExpression: 'clusterArns',
        objectIdExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
      {
        operation: 'ListServices',
        label: 'List services',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AmazonEC2ContainerServiceV20141113.ListServices',
        },
        body: '{}',
        arrayExpression: 'serviceArns',
        objectIdExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
      {
        operation: 'ListTaskDefinitions',
        label: 'List task definitions',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target':
            'AmazonEC2ContainerServiceV20141113.ListTaskDefinitions',
        },
        body: '{}',
        arrayExpression: 'taskDefinitionArns',
        objectIdExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
      {
        operation: 'DescribeClusters',
        label: 'Describe clusters',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AmazonEC2ContainerServiceV20141113.DescribeClusters',
        },
        body: '{"clusters":["{{value}}"],"include":["TAGS"]}',
        arrayExpression: 'clusters',
        objectIdExpression: 'clusterArn',
      },
      {
        operation: 'DescribeServices',
        label: 'Describe services',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AmazonEC2ContainerServiceV20141113.DescribeServices',
        },
        body: '{"cluster":"{{_parent.value}}","services":["{{value}}"],"include":["TAGS"]}',
        arrayExpression: 'services',
        objectIdExpression: 'serviceArn',
      },
      {
        operation: 'DescribeTaskDefinition',
        label: 'Describe task definition',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target':
            'AmazonEC2ContainerServiceV20141113.DescribeTaskDefinition',
        },
        body: '{"taskDefinition":"{{value}}","include":["TAGS"]}',
        arrayExpression: '$',
        objectIdExpression: 'taskDefinition.taskDefinitionArn',
      },
    ],
  },
  {
    service: 'eks',
    label: 'Amazon EKS',
    operations: [
      {
        operation: 'ListClusters',
        label: 'List clusters',
        protocol: 'rest-json',
        method: 'GET',
        path: '/clusters',
        arrayExpression: 'clusters',
        objectIdExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
      {
        operation: 'DescribeCluster',
        label: 'Describe cluster',
        protocol: 'rest-json',
        method: 'GET',
        path: '/clusters/{{id}}',
        arrayExpression: 'cluster',
        objectIdExpression: 'arn',
      },
      {
        operation: 'ListNodegroups',
        label: 'List node groups',
        protocol: 'rest-json',
        method: 'GET',
        path: '/clusters/{{name}}/node-groups',
        arrayExpression: 'nodegroups',
        objectIdExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
      {
        operation: 'DescribeNodegroup',
        label: 'Describe node group',
        protocol: 'rest-json',
        method: 'GET',
        path: '/clusters/{{_parent.name}}/node-groups/{{value}}',
        arrayExpression: 'nodegroup',
        objectIdExpression: 'nodegroupArn',
      },
    ],
  },
  {
    service: 'elasticfilesystem',
    label: 'Amazon EFS',
    operations: [
      {
        operation: 'DescribeFileSystems',
        label: 'Describe file systems',
        protocol: 'rest-json',
        method: 'GET',
        path: '/2015-02-01/file-systems',
        arrayExpression: 'FileSystems',
        objectIdExpression: 'FileSystemArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'NextMarker',
        },
      },
    ],
  },
  {
    service: 'elasticache',
    label: 'Amazon ElastiCache',
    operations: [
      {
        operation: 'DescribeCacheClusters',
        label: 'Describe cache clusters',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeCacheClusters&Version=2015-02-02',
        arrayExpression:
          'DescribeCacheClustersResponse.DescribeCacheClustersResult.CacheClusters.CacheCluster',
        objectIdExpression: 'CacheClusterId',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeCacheClustersResponse.DescribeCacheClustersResult.Marker',
        },
      },
      {
        operation: 'DescribeReplicationGroups',
        label: 'Describe replication groups',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeReplicationGroups&Version=2015-02-02',
        arrayExpression:
          'DescribeReplicationGroupsResponse.DescribeReplicationGroupsResult.ReplicationGroups.ReplicationGroup',
        objectIdExpression: 'ReplicationGroupId',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeReplicationGroupsResponse.DescribeReplicationGroupsResult.Marker',
        },
      },
    ],
  },
  {
    service: 'elasticloadbalancing',
    label: 'Elastic Load Balancing',
    operations: [
      {
        operation: 'DescribeLoadBalancers',
        label: 'Describe load balancers',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeLoadBalancers&Version=2015-12-01',
        arrayExpression:
          'DescribeLoadBalancersResponse.DescribeLoadBalancersResult.LoadBalancers.member',
        objectIdExpression: 'LoadBalancerArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeLoadBalancersResponse.DescribeLoadBalancersResult.NextMarker',
        },
      },
      {
        operation: 'DescribeTargetGroups',
        label: 'Describe target groups',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeTargetGroups&Version=2015-12-01',
        arrayExpression:
          'DescribeTargetGroupsResponse.DescribeTargetGroupsResult.TargetGroups.member',
        objectIdExpression: 'TargetGroupArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeTargetGroupsResponse.DescribeTargetGroupsResult.NextMarker',
        },
      },
      {
        operation: 'DescribeTags',
        label: 'Describe tags',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeTags&Version=2015-12-01&ResourceArns.member.1={{id}}',
        arrayExpression:
          'DescribeTagsResponse.DescribeTagsResult.TagDescriptions.member',
        objectIdExpression: 'ResourceArn',
      },
    ],
  },
  {
    service: 'events',
    label: 'Amazon EventBridge',
    operations: [
      {
        operation: 'ListEventBuses',
        label: 'List event buses',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSEvents.ListEventBuses',
        },
        body: '{}',
        arrayExpression: 'EventBuses',
        objectIdExpression: 'Arn',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
      {
        operation: 'ListRules',
        label: 'List rules',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSEvents.ListRules',
        },
        body: '{}',
        arrayExpression: 'Rules',
        objectIdExpression: 'Arn',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'lambda',
    label: 'AWS Lambda',
    operations: [
      {
        operation: 'ListFunctions',
        label: 'List functions',
        protocol: 'rest-json',
        method: 'GET',
        path: '/2015-03-31/functions/',
        arrayExpression: 'Functions',
        objectIdExpression: 'FunctionArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'NextMarker',
        },
      },
      {
        operation: 'GetFunction',
        label: 'Get function',
        protocol: 'rest-json',
        method: 'GET',
        path: '/2015-03-31/functions/{{id}}',
        arrayExpression: '$',
        objectIdExpression: 'Configuration.FunctionArn',
      },
      {
        operation: 'ListEventSourceMappings',
        label: 'List event source mappings',
        protocol: 'rest-json',
        method: 'GET',
        path: '/2015-03-31/event-source-mappings/',
        arrayExpression: 'EventSourceMappings',
        objectIdExpression: 'UUID',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'NextMarker',
        },
      },
      {
        operation: 'ListLayers',
        label: 'List layers',
        protocol: 'rest-json',
        method: 'GET',
        path: '/2018-10-31/layers',
        arrayExpression: 'Layers',
        objectIdExpression: 'LayerArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'NextMarker',
        },
      },
      {
        operation: 'ListTags',
        label: 'List tags',
        protocol: 'rest-json',
        method: 'GET',
        path: '/2017-03-31/tags/{{id}}',
        arrayExpression: '$',
        objectIdExpression:
          '$string(_parent.FunctionArn ? _parent.FunctionArn : _parent.value)',
      },
    ],
  },
  {
    service: 'glue',
    label: 'AWS Glue',
    operations: [
      {
        operation: 'GetCrawlers',
        label: 'Get crawlers',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSGlue.GetCrawlers',
        },
        body: '{}',
        arrayExpression: 'Crawlers',
        objectIdExpression: 'Name',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
      {
        operation: 'GetDatabases',
        label: 'Get databases',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSGlue.GetDatabases',
        },
        body: '{}',
        arrayExpression: 'DatabaseList',
        objectIdExpression: 'Name',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
      {
        operation: 'GetJobs',
        label: 'Get jobs',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSGlue.GetJobs',
        },
        body: '{}',
        arrayExpression: 'Jobs',
        objectIdExpression: 'Name',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'iam',
    label: 'AWS Identity and Access Management',
    operations: [
      {
        operation: 'ListUsers',
        label: 'List users',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListUsers&Version=2010-05-08',
        hostname: 'iam.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'ListUsersResponse.ListUsersResult.Users.member',
        objectIdExpression: 'Arn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'ListUsersResponse.ListUsersResult.Marker',
        },
      },
      {
        operation: 'ListRoles',
        label: 'List roles',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListRoles&Version=2010-05-08',
        hostname: 'iam.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'ListRolesResponse.ListRolesResult.Roles.member',
        objectIdExpression: 'Arn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'ListRolesResponse.ListRolesResult.Marker',
        },
      },
      {
        operation: 'ListPolicies',
        label: 'List policies',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListPolicies&Version=2010-05-08',
        hostname: 'iam.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression:
          'ListPoliciesResponse.ListPoliciesResult.Policies.member',
        objectIdExpression: 'Arn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'ListPoliciesResponse.ListPoliciesResult.Marker',
        },
      },
      {
        operation: 'ListGroups',
        label: 'List groups',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListGroups&Version=2010-05-08',
        hostname: 'iam.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'ListGroupsResponse.ListGroupsResult.Groups.member',
        objectIdExpression: 'Arn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'ListGroupsResponse.ListGroupsResult.Marker',
        },
      },
      {
        operation: 'ListInstanceProfiles',
        label: 'List instance profiles',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListInstanceProfiles&Version=2010-05-08',
        hostname: 'iam.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression:
          'ListInstanceProfilesResponse.ListInstanceProfilesResult.InstanceProfiles.member',
        objectIdExpression: 'Arn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'ListInstanceProfilesResponse.ListInstanceProfilesResult.Marker',
        },
      },
      {
        operation: 'ListEntitiesForPolicy',
        label: 'List entities for policy',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListEntitiesForPolicy&Version=2010-05-08',
        hostname: 'iam.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression:
          'ListEntitiesForPolicyResponse.ListEntitiesForPolicyResult.PolicyUsers.member',
        objectIdExpression: 'UserName',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'ListEntitiesForPolicyResponse.ListEntitiesForPolicyResult.Marker',
        },
      },
      {
        operation: 'GetGroup',
        label: 'Get group',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=GetGroup&Version=2010-05-08',
        hostname: 'iam.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'GetGroupResponse.GetGroupResult.Users.member',
        objectIdExpression: 'UserName',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'GetGroupResponse.GetGroupResult.Marker',
        },
      },
      {
        operation: 'ListRoleTags',
        label: 'List role tags',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListRoleTags&Version=2010-05-08&RoleName={{RoleName ? RoleName : RoleNameFromArn}}',
        hostname: 'iam.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'ListRoleTagsResponse.ListRoleTagsResult.Tags.member',
        objectIdExpression: '$string(_parent.Arn)',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'ListRoleTagsResponse.ListRoleTagsResult.Marker',
        },
      },
    ],
  },
  {
    service: 'kms',
    label: 'AWS Key Management Service',
    operations: [
      {
        operation: 'ListKeys',
        label: 'List keys',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'TrentService.ListKeys',
        },
        body: '{}',
        arrayExpression: 'Keys',
        objectIdExpression: 'KeyArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'NextMarker',
        },
      },
      {
        operation: 'ListAliases',
        label: 'List aliases',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'TrentService.ListAliases',
        },
        body: '{}',
        arrayExpression: 'Aliases',
        objectIdExpression: 'AliasArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'NextMarker',
        },
      },
    ],
  },
  {
    service: 'logs',
    label: 'Amazon CloudWatch Logs',
    operations: [
      {
        operation: 'DescribeLogGroups',
        label: 'Describe log groups',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'Logs_20140328.DescribeLogGroups',
        },
        body: '{}',
        arrayExpression: 'logGroups',
        objectIdExpression: 'logGroupName',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
  {
    service: 'organizations',
    label: 'AWS Organizations',
    operations: [
      {
        operation: 'ListAccounts',
        label: 'List accounts',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        hostname: 'organizations.us-east-1.amazonaws.com',
        signingRegion: 'us-east-1',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSOrganizationsV20161128.ListAccounts',
        },
        body: '{}',
        arrayExpression: 'Accounts',
        objectIdExpression: 'Id',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
      {
        operation: 'DescribeAccount',
        label: 'Describe account',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        hostname: 'organizations.us-east-1.amazonaws.com',
        signingRegion: 'us-east-1',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSOrganizationsV20161128.DescribeAccount',
        },
        body: '{"AccountId":"{{id}}"}',
        arrayExpression: 'Account',
        objectIdExpression: 'Id',
      },
      {
        operation: 'ListOrganizationalUnitsForParent',
        label: 'List organizational units for parent',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        hostname: 'organizations.us-east-1.amazonaws.com',
        signingRegion: 'us-east-1',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target':
            'AWSOrganizationsV20161128.ListOrganizationalUnitsForParent',
        },
        body: '{}',
        arrayExpression: 'OrganizationalUnits',
        objectIdExpression: 'Id',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
      {
        operation: 'ListTagsForResource',
        label: 'List tags for resource',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        hostname: 'organizations.us-east-1.amazonaws.com',
        signingRegion: 'us-east-1',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSOrganizationsV20161128.ListTagsForResource',
        },
        body: '{}',
        arrayExpression: 'Tags',
        objectIdExpression: 'Key',
      },
    ],
  },
  {
    service: 'rds',
    label: 'Amazon RDS',
    operations: [
      {
        operation: 'DescribeDBInstances',
        label: 'Describe DB instances',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeDBInstances&Version=2014-10-31',
        arrayExpression:
          'DescribeDBInstancesResponse.DescribeDBInstancesResult.DBInstances.DBInstance',
        objectIdExpression: 'DBInstanceArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeDBInstancesResponse.DescribeDBInstancesResult.Marker',
        },
      },
      {
        operation: 'DescribeDBSubnetGroups',
        label: 'Describe DB subnet groups',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeDBSubnetGroups&Version=2014-10-31',
        arrayExpression:
          'DescribeDBSubnetGroupsResponse.DescribeDBSubnetGroupsResult.DBSubnetGroups.DBSubnetGroup',
        objectIdExpression: 'DBSubnetGroupArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeDBSubnetGroupsResponse.DescribeDBSubnetGroupsResult.Marker',
        },
      },
      {
        operation: 'DescribeDBClusters',
        label: 'Describe DB clusters',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeDBClusters&Version=2014-10-31',
        arrayExpression:
          'DescribeDBClustersResponse.DescribeDBClustersResult.DBClusters.DBCluster',
        objectIdExpression: 'DBClusterArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeDBClustersResponse.DescribeDBClustersResult.Marker',
        },
      },
      {
        operation: 'DescribeDBSnapshots',
        label: 'Describe DB snapshots',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeDBSnapshots&Version=2014-10-31',
        arrayExpression:
          'DescribeDBSnapshotsResponse.DescribeDBSnapshotsResult.DBSnapshots.DBSnapshot',
        objectIdExpression: 'DBSnapshotArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeDBSnapshotsResponse.DescribeDBSnapshotsResult.Marker',
        },
      },
    ],
  },
  {
    service: 's3',
    label: 'Amazon S3',
    operations: [
      {
        operation: 'ListBuckets',
        label: 'List buckets',
        protocol: 'rest-xml',
        method: 'GET',
        path: '/',
        hostname: 's3.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'ListAllMyBucketsResult.Buckets.Bucket',
        objectIdExpression: 'Name',
      },
    ],
  },
  {
    service: 'secretsmanager',
    label: 'AWS Secrets Manager',
    operations: [
      {
        operation: 'ListSecrets',
        label: 'List secrets',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'secretsmanager.ListSecrets',
        },
        body: '{}',
        arrayExpression: 'SecretList',
        objectIdExpression: 'ARN',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'sns',
    label: 'Amazon SNS',
    operations: [
      {
        operation: 'ListTopics',
        label: 'List topics',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListTopics&Version=2010-03-31',
        arrayExpression: 'ListTopicsResponse.ListTopicsResult.Topics.member',
        objectIdExpression: 'TopicArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'ListTopicsResponse.ListTopicsResult.NextToken',
        },
      },
      {
        operation: 'GetTopicAttributes',
        label: 'Get topic attributes',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=GetTopicAttributes&Version=2010-03-31&TopicArn={{id}}',
        arrayExpression:
          '[GetTopicAttributesResponse.GetTopicAttributesResult.Attributes.entry{key: value}]',
        objectIdExpression: 'TopicArn',
      },
    ],
  },
  {
    service: 'sqs',
    label: 'Amazon SQS',
    operations: [
      {
        operation: 'ListQueues',
        label: 'List queues',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=ListQueues&Version=2012-11-05',
        arrayExpression: 'ListQueuesResponse.ListQueuesResult.QueueUrl',
        objectIdExpression: '$',
      },
      {
        operation: 'GetQueueAttributes',
        label: 'Get queue attributes',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=GetQueueAttributes&Version=2012-11-05&AttributeName=All&QueueUrl={{id}}',
        arrayExpression:
          '[GetQueueAttributesResponse.GetQueueAttributesResult.Attribute{Name: Value}]',
        objectIdExpression: 'QueueArn',
      },
    ],
  },
  {
    service: 'ssm',
    label: 'AWS Systems Manager',
    operations: [
      {
        operation: 'DescribeParameters',
        label: 'Describe parameters',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AmazonSSM.DescribeParameters',
        },
        body: '{}',
        arrayExpression: 'Parameters',
        objectIdExpression: 'Name',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
      {
        operation: 'DescribeInstanceInformation',
        label: 'Describe instance information',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AmazonSSM.DescribeInstanceInformation',
        },
        body: '{}',
        arrayExpression: 'InstanceInformationList',
        objectIdExpression: 'InstanceId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
      {
        operation: 'ListDocuments',
        label: 'List documents',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AmazonSSM.ListDocuments',
        },
        body: '{}',
        arrayExpression: 'DocumentIdentifiers',
        objectIdExpression: 'Name',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'autoscaling',
    label: 'Amazon EC2 Auto Scaling',
    operations: [
      {
        operation: 'DescribeAutoScalingGroups',
        label: 'Describe Auto Scaling groups',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeAutoScalingGroups&Version=2011-01-01',
        arrayExpression:
          'DescribeAutoScalingGroupsResponse.DescribeAutoScalingGroupsResult.AutoScalingGroups.member',
        objectIdExpression: 'AutoScalingGroupARN',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression:
            'DescribeAutoScalingGroupsResponse.DescribeAutoScalingGroupsResult.NextToken',
        },
      },
    ],
  },
  {
    service: 'backup',
    label: 'AWS Backup',
    operations: [
      {
        operation: 'ListBackupVaults',
        label: 'List backup vaults',
        protocol: 'rest-json',
        method: 'GET',
        path: '/backup-vaults',
        arrayExpression: 'BackupVaultList',
        objectIdExpression: 'BackupVaultArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
      {
        operation: 'ListBackupPlans',
        label: 'List backup plans',
        protocol: 'rest-json',
        method: 'GET',
        path: '/backup/plans',
        arrayExpression: 'BackupPlansList',
        objectIdExpression: 'BackupPlanArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression: 'NextToken',
        },
      },
    ],
  },
  {
    service: 'cloudformation',
    label: 'AWS CloudFormation',
    operations: [
      {
        operation: 'DescribeStacks',
        label: 'Describe stacks',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeStacks&Version=2010-05-15',
        arrayExpression:
          'DescribeStacksResponse.DescribeStacksResult.Stacks.member',
        objectIdExpression: 'StackId',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextToken',
          nextCursorExpression:
            'DescribeStacksResponse.DescribeStacksResult.NextToken',
        },
      },
    ],
  },
  {
    service: 'cloudfront',
    label: 'Amazon CloudFront',
    operations: [
      {
        operation: 'ListDistributions',
        label: 'List distributions',
        protocol: 'rest-xml',
        method: 'GET',
        path: '/2020-05-31/distribution',
        hostname: 'cloudfront.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'DistributionList.Items.DistributionSummary',
        objectIdExpression: 'ARN ? ARN : Id',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'DistributionList.NextMarker',
        },
      },
    ],
  },
  {
    service: 'cloudtrail',
    label: 'AWS CloudTrail',
    operations: [
      {
        operation: 'DescribeTrails',
        label: 'Describe trails',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target':
            'com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.DescribeTrails',
        },
        body: '{}',
        arrayExpression: 'trailList',
        objectIdExpression: 'TrailARN',
      },
    ],
  },
  {
    service: 'guardduty',
    label: 'Amazon GuardDuty',
    operations: [
      {
        operation: 'ListDetectors',
        label: 'List detectors',
        protocol: 'rest-json',
        method: 'GET',
        path: '/detector',
        arrayExpression: 'DetectorIds',
        objectIdExpression: '$',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
  {
    service: 'redshift',
    label: 'Amazon Redshift',
    operations: [
      {
        operation: 'DescribeClusters',
        label: 'Describe clusters',
        protocol: 'aws-query',
        method: 'GET',
        path: '/?Action=DescribeClusters&Version=2012-12-01',
        arrayExpression:
          'DescribeClustersResponse.DescribeClustersResult.Clusters.Cluster',
        objectIdExpression:
          'ClusterNamespaceArn ? ClusterNamespaceArn : ClusterIdentifier',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression:
            'DescribeClustersResponse.DescribeClustersResult.Marker',
        },
      },
    ],
  },
  {
    service: 'route53',
    label: 'Amazon Route 53',
    operations: [
      {
        operation: 'ListHostedZones',
        label: 'List hosted zones',
        protocol: 'rest-xml',
        method: 'GET',
        path: '/2013-04-01/hostedzone',
        hostname: 'route53.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'ListHostedZonesResponse.HostedZones.HostedZone',
        objectIdExpression: 'Id',
        pagination: {
          type: 'cursor',
          cursorParam: 'marker',
          nextCursorExpression: 'ListHostedZonesResponse.NextMarker',
        },
      },
    ],
  },
  {
    service: 'tagging',
    label: 'AWS Resource Groups Tagging API',
    operations: [
      {
        operation: 'GetResources',
        label: 'Get tagged resources',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'ResourceGroupsTaggingAPI_20170126.GetResources',
        },
        body: '{}',
        arrayExpression: 'ResourceTagMappingList',
        objectIdExpression: 'ResourceARN',
        pagination: {
          type: 'cursor',
          cursorParam: 'PaginationToken',
          nextCursorExpression: 'PaginationToken',
        },
      },
    ],
  },
  {
    service: 'wafv2',
    label: 'AWS WAF V2',
    operations: [
      {
        operation: 'ListWebACLs',
        label: 'List web ACLs',
        protocol: 'aws-json-1.1',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSWAF_20190729.ListWebACLs',
        },
        body: '{"Scope":"REGIONAL"}',
        arrayExpression: 'WebACLs',
        objectIdExpression: 'ARN',
        pagination: {
          type: 'cursor',
          cursorParam: 'NextMarker',
          nextCursorExpression: 'NextMarker',
        },
      },
    ],
  },
  {
    service: 'states',
    label: 'AWS Step Functions',
    operations: [
      {
        operation: 'ListStateMachines',
        label: 'List state machines',
        protocol: 'aws-json-1.0',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.0',
          'x-amz-target': 'AWSStepFunctions.ListStateMachines',
        },
        body: '{}',
        arrayExpression: 'stateMachines',
        objectIdExpression: 'stateMachineArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
      {
        operation: 'ListActivities',
        label: 'List activities',
        protocol: 'aws-json-1.0',
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.0',
          'x-amz-target': 'AWSStepFunctions.ListActivities',
        },
        body: '{}',
        arrayExpression: 'activities',
        objectIdExpression: 'activityArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      },
    ],
  },
];

export function listAwsServices(): AwsServiceMetadata[] {
  return AWS_SERVICE_API_METADATA;
}

export function getAwsServiceMetadata(
  service: string | undefined,
): AwsServiceMetadata | undefined {
  if (!service) {
    return undefined;
  }
  const normalized = service.toLowerCase();
  return AWS_SERVICE_API_METADATA.find(
    candidate => candidate.service.toLowerCase() === normalized,
  );
}

export function getAwsOperationMetadata(
  service: string | undefined,
  operation: string | undefined,
): AwsOperationMetadata | undefined {
  if (!service || !operation) {
    return undefined;
  }
  const serviceMetadata = getAwsServiceMetadata(service);
  if (!serviceMetadata) {
    return undefined;
  }
  const normalizedOperation = operation.toLowerCase();
  return serviceMetadata.operations.find(
    candidate => candidate.operation.toLowerCase() === normalizedOperation,
  );
}
