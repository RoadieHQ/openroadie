/*
 * Copyright 2026 Larder Software Ltd.
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
import { describe, expect, it } from 'vitest';
import {
  checkSourceConfigured,
  isAwsSourceConfigured,
} from './source-configured';

describe('isAwsSourceConfigured', () => {
  it('accepts a cloud-control (resource-type) source like ECR', () => {
    // The shape that the old backend copy wrongly rejected: no service/region/
    // resourceArn, just account targets + a resource type.
    expect(
      isAwsSourceConfigured({
        accountIds: ['123456789012'],
        regions: ['eu-west-1'],
        resourceType: 'AWS::ECR::Repository',
      }),
    ).toBe(true);
  });

  it('accepts dynamic "all accounts" selection', () => {
    expect(
      isAwsSourceConfigured({
        accountSelection: { mode: 'all' },
        resourceType: 'AWS::ECR::Repository',
      }),
    ).toBe(true);
  });

  it('rejects when no account target is set', () => {
    expect(
      isAwsSourceConfigured({ resourceType: 'AWS::ECR::Repository' }),
    ).toBe(false);
  });

  it('rejects an invalid account id', () => {
    expect(
      isAwsSourceConfigured({
        accountIds: ['not-an-account'],
        resourceType: 'AWS::ECR::Repository',
      }),
    ).toBe(false);
  });

  it('rejects a cloud-control source with invalid resource-model JSON', () => {
    expect(
      isAwsSourceConfigured({
        accountIds: ['123456789012'],
        resourceType: 'AWS::ECR::Repository',
        resourceModel: '{ not json',
      }),
    ).toBe(false);
  });

  it('accepts a seeded service-api source that uses operation metadata defaults', () => {
    const base = {
      accountSelection: { mode: 'all' },
      mode: 'service-api',
    };
    expect(isAwsSourceConfigured(base)).toBe(false);
    expect(
      isAwsSourceConfigured({
        ...base,
        service: 's3',
        operation: 'ListBuckets',
      }),
    ).toBe(true);
  });

  it('accepts configured-accounts mode without account targets', () => {
    expect(
      isAwsSourceConfigured({
        mode: 'configured-accounts',
        integrationId: 'aws-1',
      }),
    ).toBe(true);
  });
});

describe('checkSourceConfigured', () => {
  it('treats a datastore source as configured when it has a datasourceId', () => {
    expect(
      checkSourceConfigured('source-datastore', { datasourceId: 'x' }),
    ).toBe(true);
    expect(checkSourceConfigured('source-datastore', {})).toBe(false);
  });

  it('routes AWS integration-backed sources through the AWS check', () => {
    // A source-integration node classified as AWS by the integration backend.
    expect(
      checkSourceConfigured(
        'source-integration',
        {
          integrationId: 'i1',
          accountIds: ['123456789012'],
          resourceType: 'x',
        },
        'aws',
      ),
    ).toBe(true);
  });

  it('requires integrationId + path for an http source', () => {
    expect(
      checkSourceConfigured('source-integration', { integrationId: 'i1' }),
    ).toBe(false);
    expect(
      checkSourceConfigured('source-integration', {
        integrationId: 'i1',
        path: '/repos',
      }),
    ).toBe(true);
  });

  it('requires a graphql query in graphql mode', () => {
    expect(
      checkSourceConfigured('source-integration', {
        integrationId: 'i1',
        mode: 'graphql',
      }),
    ).toBe(false);
    expect(
      checkSourceConfigured('source-integration', {
        integrationId: 'i1',
        mode: 'graphql',
        graphqlQuery: '{ viewer { login } }',
      }),
    ).toBe(true);
  });

  it('returns false without a source type or config', () => {
    expect(checkSourceConfigured(undefined, { integrationId: 'i1' })).toBe(
      false,
    );
    expect(checkSourceConfigured('source-integration', undefined)).toBe(false);
  });
});
