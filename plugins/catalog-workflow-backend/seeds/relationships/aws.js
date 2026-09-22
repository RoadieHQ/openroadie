function relationship(input) {
  return {
    strategy: 'field-matching',
    matchStrategy: 'exact',
    ...input,
  };
}

function sameResource(name, targetSeedName, targetFieldExpression) {
  return relationship({
    name,
    description: `Links AWS tagged resources to ${targetSeedName} records with the same ARN.`,
    sourceSeedName: 'AWS tagged resources',
    targetSeedName,
    sourceFieldExpression: 'ResourceARN',
    targetFieldExpression,
    relationshipType: 'sameResource',
    reciprocalRelationshipType: 'sameResource',
  });
}

function accountResource(
  targetSeedName,
  targetFieldExpression = '_aws.accountId',
) {
  return relationship({
    name: `AWS account → ${targetSeedName.replace(/^AWS /, '')}`,
    description: `Links AWS accounts to ${targetSeedName} records discovered in the account.`,
    sourceSeedName: 'AWS accounts',
    targetSeedName,
    sourceFieldExpression: 'Id',
    targetFieldExpression,
    relationshipType: 'hasResource',
    reciprocalRelationshipType: 'resourceOf',
  });
}

const tagJoins = [
  sameResource(
    'AWS tagged resource → EC2 instances',
    'AWS EC2 instances',
    'instanceId ? "arn:aws:ec2:" & _aws.region & ":" & _aws.accountId & ":instance/" & instanceId : undefined',
  ),
  sameResource(
    'AWS tagged resource → EC2 volumes',
    'AWS EC2 volumes',
    'volumeId ? "arn:aws:ec2:" & _aws.region & ":" & _aws.accountId & ":volume/" & volumeId : undefined',
  ),
  sameResource(
    'AWS tagged resource → EC2 VPCs',
    'AWS EC2 VPCs',
    'vpcId ? "arn:aws:ec2:" & _aws.region & ":" & _aws.accountId & ":vpc/" & vpcId : undefined',
  ),
  sameResource(
    'AWS tagged resource → EC2 subnets',
    'AWS EC2 subnets',
    'subnetId ? "arn:aws:ec2:" & _aws.region & ":" & _aws.accountId & ":subnet/" & subnetId : undefined',
  ),
  sameResource(
    'AWS tagged resource → EC2 security groups',
    'AWS EC2 security groups',
    'groupId ? "arn:aws:ec2:" & _aws.region & ":" & _aws.accountId & ":security-group/" & groupId : undefined',
  ),
  sameResource(
    'AWS tagged resource → ECR repositories',
    'AWS ECR repositories',
    'repositoryArn',
  ),
  sameResource(
    'AWS tagged resource → ECS clusters',
    'AWS ECS clusters',
    'clusterArn',
  ),
  sameResource(
    'AWS tagged resource → ECS services',
    'AWS ECS services',
    'serviceArn',
  ),
  sameResource(
    'AWS tagged resource → EFS file systems',
    'AWS EFS file systems',
    'FileSystemArn',
  ),
  sameResource('AWS tagged resource → EKS clusters', 'AWS EKS clusters', 'arn'),
  sameResource(
    'AWS tagged resource → EKS node groups',
    'AWS EKS node groups',
    'nodegroupArn',
  ),
  sameResource(
    'AWS tagged resource → ELBv2 load balancers',
    'AWS ELBv2 load balancers',
    'LoadBalancerArn',
  ),
  sameResource(
    'AWS tagged resource → ELBv2 target groups',
    'AWS ELBv2 target groups',
    'TargetGroupArn',
  ),
  sameResource(
    'AWS tagged resource → Lambda functions',
    'AWS Lambda functions',
    'FunctionArn',
  ),
  sameResource(
    'AWS tagged resource → RDS DB clusters',
    'AWS RDS DB clusters',
    'DBClusterArn',
  ),
  sameResource(
    'AWS tagged resource → RDS DB instances',
    'AWS RDS DB instances',
    'DBInstanceArn',
  ),
  sameResource(
    'AWS tagged resource → Redshift clusters',
    'AWS Redshift clusters',
    'ClusterNamespaceArn',
  ),
  sameResource(
    'AWS tagged resource → S3 buckets',
    'AWS S3 buckets',
    '"arn:aws:s3:::" & Name',
  ),
  sameResource(
    'AWS tagged resource → Secrets Manager secrets',
    'AWS Secrets Manager secrets',
    'ARN',
  ),
  sameResource(
    'AWS tagged resource → SNS topics',
    'AWS SNS topics',
    'TopicArn',
  ),
  sameResource(
    'AWS tagged resource → CloudFormation stacks',
    'AWS CloudFormation stacks',
    'StackId',
  ),
];

const accountLinks = [
  'AWS tagged resources',
  'AWS EC2 instances',
  'AWS EC2 volumes',
  'AWS EC2 VPCs',
  'AWS EC2 subnets',
  'AWS EC2 security groups',
  'AWS EC2 NAT gateways',
  'AWS EC2 internet gateways',
  'AWS ECS clusters',
  'AWS ECS services',
  'AWS ECS task definitions',
  'AWS EKS clusters',
  'AWS EKS node groups',
  'AWS Lambda functions',
  'AWS RDS DB clusters',
  'AWS RDS DB instances',
  'AWS S3 buckets',
  'AWS CloudFormation stacks',
  'AWS App Runner services',
].map(seedName =>
  accountResource(
    seedName,
    seedName === 'AWS App Runner services' ? 'accountId' : '_aws.accountId',
  ),
);

module.exports = [
  ...tagJoins,
  ...accountLinks,
  relationship({
    name: 'AWS VPC → subnets',
    description: 'Links each AWS VPC to subnets in that VPC.',
    sourceSeedName: 'AWS EC2 VPCs',
    targetSeedName: 'AWS EC2 subnets',
    sourceFieldExpression: 'vpcId',
    targetFieldExpression: 'vpcId',
    relationshipType: 'containsSubnet',
    reciprocalRelationshipType: 'subnetOf',
  }),
  relationship({
    name: 'AWS VPC → security groups',
    description: 'Links each AWS VPC to security groups in that VPC.',
    sourceSeedName: 'AWS EC2 VPCs',
    targetSeedName: 'AWS EC2 security groups',
    sourceFieldExpression: 'vpcId',
    targetFieldExpression: 'vpcId',
    relationshipType: 'containsSecurityGroup',
    reciprocalRelationshipType: 'securityGroupOf',
  }),
  relationship({
    name: 'AWS VPC → NAT gateways',
    description: 'Links each AWS VPC to NAT gateways in that VPC.',
    sourceSeedName: 'AWS EC2 VPCs',
    targetSeedName: 'AWS EC2 NAT gateways',
    sourceFieldExpression: 'vpcId',
    targetFieldExpression: 'vpcId',
    relationshipType: 'containsGateway',
    reciprocalRelationshipType: 'gatewayOf',
  }),
  relationship({
    name: 'AWS VPC → internet gateways',
    description: 'Links each AWS VPC to attached internet gateways.',
    sourceSeedName: 'AWS EC2 VPCs',
    targetSeedName: 'AWS EC2 internet gateways',
    matchStrategy: 'array_contains',
    sourceFieldExpression: 'vpcId',
    targetFieldExpression: 'attachmentSet.item.vpcId',
    relationshipType: 'containsGateway',
    reciprocalRelationshipType: 'gatewayOf',
  }),
  relationship({
    name: 'AWS EC2 instance → subnet',
    description: 'Links EC2 instances to their subnet.',
    sourceSeedName: 'AWS EC2 instances',
    targetSeedName: 'AWS EC2 subnets',
    sourceFieldExpression: 'subnetId',
    targetFieldExpression: 'subnetId',
    relationshipType: 'runsInSubnet',
    reciprocalRelationshipType: 'subnetContainsInstance',
  }),
  relationship({
    name: 'AWS EC2 instance → security groups',
    description: 'Links EC2 instances to attached security groups.',
    sourceSeedName: 'AWS EC2 instances',
    targetSeedName: 'AWS EC2 security groups',
    matchStrategy: 'array_contains',
    sourceFieldExpression: 'groupSet.item.groupId',
    targetFieldExpression: 'groupId',
    relationshipType: 'usesSecurityGroup',
    reciprocalRelationshipType: 'securityGroupUsedBy',
  }),
  relationship({
    name: 'AWS EC2 instance → volumes',
    description: 'Links EC2 instances to attached EBS volumes.',
    sourceSeedName: 'AWS EC2 instances',
    targetSeedName: 'AWS EC2 volumes',
    matchStrategy: 'array_contains',
    sourceFieldExpression: 'instanceId',
    targetFieldExpression: 'attachmentSet.item.instanceId',
    relationshipType: 'usesVolume',
    reciprocalRelationshipType: 'volumeAttachedTo',
  }),
  relationship({
    name: 'AWS ELBv2 load balancer → target groups',
    description: 'Links ELBv2 load balancers to target groups.',
    sourceSeedName: 'AWS ELBv2 load balancers',
    targetSeedName: 'AWS ELBv2 target groups',
    matchStrategy: 'array_contains',
    sourceFieldExpression: 'LoadBalancerArn',
    targetFieldExpression: 'LoadBalancerArns.member',
    relationshipType: 'routesToTargetGroup',
    reciprocalRelationshipType: 'targetGroupForLoadBalancer',
  }),
  relationship({
    name: 'AWS RDS DB cluster → instances',
    description: 'Links RDS DB clusters to member DB instances.',
    sourceSeedName: 'AWS RDS DB clusters',
    targetSeedName: 'AWS RDS DB instances',
    sourceFieldExpression: 'DBClusterIdentifier',
    targetFieldExpression: 'DBClusterIdentifier',
    relationshipType: 'hasDbInstance',
    reciprocalRelationshipType: 'dbInstanceOf',
  }),
  relationship({
    name: 'AWS ECS cluster → services',
    description:
      'Links ECS clusters to ECS services described from that cluster.',
    sourceSeedName: 'AWS ECS clusters',
    targetSeedName: 'AWS ECS services',
    sourceFieldExpression: 'clusterArn',
    targetFieldExpression: '_parent._parent.value',
    relationshipType: 'runsService',
    reciprocalRelationshipType: 'serviceRunsOnCluster',
  }),
  relationship({
    name: 'AWS ECS task definition → services',
    description: 'Links ECS task definitions to services using them.',
    sourceSeedName: 'AWS ECS task definitions',
    targetSeedName: 'AWS ECS services',
    sourceFieldExpression: 'taskDefinition.taskDefinitionArn',
    targetFieldExpression: 'taskDefinition',
    relationshipType: 'definesTaskForService',
    reciprocalRelationshipType: 'serviceUsesTaskDefinition',
  }),
  relationship({
    name: 'AWS EKS cluster → node groups',
    description:
      'Links EKS clusters to node groups described from that cluster.',
    sourceSeedName: 'AWS EKS clusters',
    targetSeedName: 'AWS EKS node groups',
    sourceFieldExpression: 'name',
    targetFieldExpression: '_parent._parent.name',
    relationshipType: 'hasNodeGroup',
    reciprocalRelationshipType: 'nodeGroupOfCluster',
  }),
  relationship({
    name: 'AWS Lambda function → event source mappings',
    description:
      'Links Lambda functions to event source mappings targeting the function.',
    sourceSeedName: 'AWS Lambda functions',
    targetSeedName: 'AWS Lambda event source mappings',
    sourceFieldExpression: 'FunctionArn',
    targetFieldExpression: 'FunctionArn',
    relationshipType: 'hasEventSourceMapping',
    reciprocalRelationshipType: 'eventSourceMappingOf',
  }),
  relationship({
    name: 'AWS ECR repository → GitHub repository',
    description:
      'Links ECR repositories to GitHub repositories with the same repository name.',
    sourceSeedName: 'AWS ECR repositories',
    targetSeedName: 'GitHub repositories',
    sourceFieldExpression: '$lowercase(repositoryName)',
    targetFieldExpression: '$lowercase(name)',
    relationshipType: 'sameRepository',
    reciprocalRelationshipType: 'sameRepository',
  }),
  relationship({
    name: 'AWS EKS cluster → Kubernetes namespaces',
    description:
      'Links EKS clusters to Kubernetes namespaces that carry the matching cluster name label.',
    sourceSeedName: 'AWS EKS clusters',
    targetSeedName: 'Kubernetes namespaces',
    sourceFieldExpression: 'name',
    targetFieldExpression: 'metadata.labels."eks.amazonaws.com/cluster-name"',
    relationshipType: 'hostsNamespace',
    reciprocalRelationshipType: 'namespaceHostedOn',
  }),
  relationship({
    name: 'AWS account → Wiz cloud resources',
    description:
      'Links AWS accounts to Wiz cloud resources for the same provider account.',
    sourceSeedName: 'AWS accounts',
    targetSeedName: 'Wiz cloud resources',
    sourceFieldExpression: 'Id',
    targetFieldExpression: 'subscriptionExternalId',
    relationshipType: 'sameResource',
    reciprocalRelationshipType: 'sameResource',
  }),
  relationship({
    name: 'AWS CloudFormation stack → tagged resources',
    description:
      'Links CloudFormation stacks to tagged resources with the matching stack-name tag.',
    sourceSeedName: 'AWS CloudFormation stacks',
    targetSeedName: 'AWS tagged resources',
    sourceFieldExpression: 'StackName',
    targetFieldExpression: 'Tags[Key="aws:cloudformation:stack-name"].Value',
    relationshipType: 'managesResource',
    reciprocalRelationshipType: 'managedByStack',
  }),
];
