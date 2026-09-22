import { describe, expect, it } from 'vitest';
import {
  getAwsServiceRequestDefaults,
  listAwsServiceMetadata,
} from './metadata';

describe('AWS service metadata', () => {
  it('exposes selectable services and operations', () => {
    const services = listAwsServiceMetadata();
    expect(services.some(service => service.service === 'acm')).toBe(true);
    expect(services.some(service => service.service === 'ec2')).toBe(true);
    expect(services.some(service => service.service === 'elasticache')).toBe(
      true,
    );
    expect(
      services.some(service => service.service === 'elasticloadbalancing'),
    ).toBe(true);
    expect(services.some(service => service.service === 'appsync')).toBe(true);
    expect(services.some(service => service.service === 'codeartifact')).toBe(
      true,
    );
    expect(services.some(service => service.service === 'es')).toBe(true);
    expect(services.some(service => service.service === 'iam')).toBe(true);
    expect(services.some(service => service.service === 'lambda')).toBe(true);
    expect(services.some(service => service.service === 'logs')).toBe(true);
    expect(services.some(service => service.service === 'states')).toBe(true);
    expect(services.some(service => service.service === 'rds')).toBe(true);
    expect(services.some(service => service.service === 's3')).toBe(true);
    expect(services.some(service => service.service === 'sns')).toBe(true);
    expect(services.some(service => service.service === 'sqs')).toBe(true);
    expect(
      services
        .find(service => service.service === 'lambda')
        ?.operations.some(operation => operation.operation === 'ListFunctions'),
    ).toBe(true);
    expect(
      services
        .find(service => service.service === 'lambda')
        ?.operations.some(operation => operation.operation === 'GetFunction'),
    ).toBe(true);
    expect(
      services
        .find(service => service.service === 'eks')
        ?.operations.some(
          operation => operation.operation === 'DescribeCluster',
        ),
    ).toBe(true);
    expect(
      services
        .find(service => service.service === 'sqs')
        ?.operations.some(
          operation => operation.operation === 'GetQueueAttributes',
        ),
    ).toBe(true);
    expect(
      services
        .find(service => service.service === 'logs')
        ?.operations.some(
          operation => operation.operation === 'DescribeLogGroups',
        ),
    ).toBe(true);
    expect(
      services
        .find(service => service.service === 'codeartifact')
        ?.operations.some(operation => operation.operation === 'ListDomains'),
    ).toBe(true);
  });

  it('returns request defaults and pagination hints for known operations', () => {
    expect(getAwsServiceRequestDefaults('lambda', 'ListFunctions')).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/2015-03-31/functions/',
        arrayExpression: 'Functions',
        objectIdExpression: 'FunctionArn',
        pagination: {
          type: 'cursor',
          cursorParam: 'Marker',
          nextCursorExpression: 'NextMarker',
        },
      }),
    );
  });

  it('returns query protocol defaults for EC2 parity operations', () => {
    expect(getAwsServiceRequestDefaults('ec2', 'DescribeInstances')).toEqual(
      expect.objectContaining({
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
      }),
    );
  });

  it('returns rest-xml defaults for S3 parity operations', () => {
    expect(getAwsServiceRequestDefaults('s3', 'ListBuckets')).toEqual(
      expect.objectContaining({
        protocol: 'rest-xml',
        method: 'GET',
        path: '/',
        hostname: 's3.amazonaws.com',
        signingRegion: 'us-east-1',
        arrayExpression: 'ListAllMyBucketsResult.Buckets.Bucket',
        objectIdExpression: 'Name',
      }),
    );
  });

  it('returns rest-json defaults for EKS detail operations', () => {
    expect(getAwsServiceRequestDefaults('eks', 'DescribeCluster')).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/clusters/{{id}}',
        arrayExpression: 'cluster',
        objectIdExpression: 'arn',
      }),
    );
  });

  it('returns query defaults for IAM operations', () => {
    expect(getAwsServiceRequestDefaults('iam', 'ListRoles')).toEqual(
      expect.objectContaining({
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
      }),
    );
  });

  it('returns detail defaults for plugin-backed AWS resources', () => {
    expect(getAwsServiceRequestDefaults('dynamodb', 'DescribeTable')).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: '{"TableName":"{{id}}"}',
        arrayExpression: 'Table',
        objectIdExpression: 'TableArn',
        headers: expect.objectContaining({
          'x-amz-target': 'DynamoDB_20120810.DescribeTable',
        }),
      }),
    );

    expect(getAwsServiceRequestDefaults('es', 'DescribeDomain')).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/2021-01-01/opensearch/domain/{{id}}',
        arrayExpression: 'DomainStatus',
        objectIdExpression: 'ARN',
      }),
    );

    expect(getAwsServiceRequestDefaults('lambda', 'GetFunction')).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/2015-03-31/functions/{{id}}',
        arrayExpression: '$',
        objectIdExpression: 'Configuration.FunctionArn',
      }),
    );

    expect(getAwsServiceRequestDefaults('sns', 'GetTopicAttributes')).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/?Action=GetTopicAttributes&Version=2010-03-31&TopicArn={{id}}',
        arrayExpression:
          '[GetTopicAttributesResponse.GetTopicAttributesResult.Attributes.entry{key: value}]',
        objectIdExpression: 'TopicArn',
      }),
    );

    expect(getAwsServiceRequestDefaults('sqs', 'GetQueueAttributes')).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/?Action=GetQueueAttributes&Version=2012-11-05&AttributeName=All&QueueUrl={{id}}',
        arrayExpression:
          '[GetQueueAttributesResponse.GetQueueAttributesResult.Attribute{Name: Value}]',
        objectIdExpression: 'QueueArn',
      }),
    );
  });

  it('returns undefined for unknown operations', () => {
    expect(
      getAwsServiceRequestDefaults('lambda', 'DefinitelyNotReal'),
    ).toBeUndefined();
  });

  it('returns header defaults for aws-json operations', () => {
    expect(getAwsServiceRequestDefaults('logs', 'DescribeLogGroups')).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/',
        arrayExpression: 'logGroups',
        objectIdExpression: 'logGroupName',
        headers: expect.objectContaining({
          'x-amz-target': 'Logs_20140328.DescribeLogGroups',
        }),
      }),
    );
  });

  it('returns rest-json defaults for newly added operations', () => {
    expect(
      getAwsServiceRequestDefaults('codeartifact', 'ListRepositories'),
    ).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/v1/repositories',
        arrayExpression: 'repositories',
        objectIdExpression: 'name',
        pagination: {
          type: 'cursor',
          cursorParam: 'nextToken',
          nextCursorExpression: 'nextToken',
        },
      }),
    );
  });

  it('returns OpenSearch service defaults', () => {
    expect(getAwsServiceRequestDefaults('es', 'ListDomainNames')).toEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/2015-01-01/domain',
        arrayExpression: 'DomainNames',
        objectIdExpression: 'DomainName',
      }),
    );
  });

  it('returns defaults for seeded AWS service additions', () => {
    expect(getAwsServiceRequestDefaults('tagging', 'GetResources')).toEqual(
      expect.objectContaining({
        method: 'POST',
        arrayExpression: 'ResourceTagMappingList',
        objectIdExpression: 'ResourceARN',
        pagination: {
          type: 'cursor',
          cursorParam: 'PaginationToken',
          nextCursorExpression: 'PaginationToken',
        },
      }),
    );
    expect(
      getAwsServiceRequestDefaults('cloudtrail', 'DescribeTrails'),
    ).toEqual(
      expect.objectContaining({
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
      }),
    );
    expect(getAwsServiceRequestDefaults('ecs', 'DescribeServices')).toEqual(
      expect.objectContaining({
        body: '{"cluster":"{{_parent.value}}","services":["{{value}}"],"include":["TAGS"]}',
        arrayExpression: 'services',
        objectIdExpression: 'serviceArn',
      }),
    );
    expect(getAwsServiceRequestDefaults('wafv2', 'ListWebACLs')).toEqual(
      expect.objectContaining({
        body: '{"Scope":"REGIONAL"}',
        arrayExpression: 'WebACLs',
        objectIdExpression: 'ARN',
      }),
    );
  });
});
