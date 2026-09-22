import { describe, expect, it } from 'vitest';
import { buildSuggestedDataSourceNameFromPipeline } from './data-source-name';

describe('buildSuggestedDataSourceNameFromPipeline', () => {
  it('strips verbs from AWS operation labels', () => {
    expect(
      buildSuggestedDataSourceNameFromPipeline({
        draftName: 'Data Source May 1',
        sourceConfig: {
          integrationName: 'AWS',
          mode: 'service-api',
          service: 'lambda',
          operation: 'ListFunctions',
        },
        transforms: [],
      }),
    ).toBe('AWS Lambda Functions');
  });

  it('uses resource type in cloud-control mode even when service fields linger', () => {
    expect(
      buildSuggestedDataSourceNameFromPipeline({
        draftName: 'Data Source May 1',
        sourceConfig: {
          integrationName: 'AWS',
          mode: 'cloud-control',
          resourceType: 'AWS::EC2::VPC',
          service: 'lambda',
          operation: 'ListFunctions',
        },
        transforms: [],
      }),
    ).toBe('AWS EC2 VPC');
  });
});
