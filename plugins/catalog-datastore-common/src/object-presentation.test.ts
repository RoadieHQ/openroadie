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
  resolveObjectPresentation,
  resolvePresentationFieldName,
} from './object-presentation';

describe('object-presentation', () => {
  it('prefers configured title over inferred infrastructure fields', () => {
    expect(
      resolveObjectPresentation(
        {
          kind: 'Deployment',
          metadata: { name: 'payments-api' },
        },
        'obj-1',
        { title: 'Custom title' },
      ),
    ).toMatchObject({ title: 'Custom title' });
  });

  it('uses kubernetes metadata.name as the default title', () => {
    expect(
      resolveObjectPresentation(
        {
          kind: 'Deployment',
          metadata: {
            name: 'payments-api',
            namespace: 'prod',
          },
        },
        'obj-1',
      ),
    ).toMatchObject({
      title: 'payments-api',
      subtitle: 'Deployment',
    });
  });

  it('uses common aws identifier fields as the default title', () => {
    expect(
      resolveObjectPresentation(
        {
          resourceType: 'AWS::RDS::DBInstance',
          DBInstanceIdentifier: 'roadie-prod-db',
        },
        'obj-2',
      ),
    ).toMatchObject({
      title: 'roadie-prod-db',
      subtitle: 'AWS::RDS::DBInstance',
    });
  });

  it('matches infrastructure keys case-insensitively', () => {
    expect(
      resolveObjectPresentation(
        {
          resourceType: 'AWS::S3::Bucket',
          BucketName: 'seeded-bucket',
        },
        'obj-case',
      ),
    ).toMatchObject({
      title: 'seeded-bucket',
      subtitle: 'AWS::S3::Bucket',
    });
  });

  it('derives a title from an arn when no better aws name exists', () => {
    expect(
      resolveObjectPresentation(
        {
          resourceType: 'AWS::ECR::Repository',
          Arn: 'arn:aws:ecr:eu-west-1:123456789012:repository/openroadie/backend',
        },
        'obj-3',
      ),
    ).toMatchObject({
      title: 'backend',
      subtitle: 'AWS::ECR::Repository',
    });
  });

  it('uses nested Jira summaries for titles and keys for subtitles', () => {
    expect(
      resolveObjectPresentation(
        {
          key: 'KAN-123',
          fields: {
            summary: 'Investigate production incident',
          },
        },
        'obj-4',
      ),
    ).toMatchObject({
      title: 'Investigate production incident',
      subtitle: 'KAN-123',
    });
  });

  it('uses seeded email variants for subtitles', () => {
    expect(
      resolveObjectPresentation(
        {
          displayName: 'Ada Lovelace',
          userPrincipalName: 'ada@example.com',
        },
        'obj-5',
      ),
    ).toMatchObject({
      title: 'Ada Lovelace',
      subtitle: 'ada@example.com',
    });
  });

  it('uses repo urls as a fallback title for argocd repositories', () => {
    expect(
      resolveObjectPresentation(
        {
          repo: 'https://github.com/argoproj/argocd-example-apps.git',
        },
        'obj-6',
      ),
    ).toMatchObject({
      title: 'https://github.com/argoproj/argocd-example-apps.git',
    });
  });

  it('resolves the source field name for a presentation value', () => {
    expect(
      resolvePresentationFieldName(
        { title: 'Fix bug', state: 'open' },
        'open',
        'subtitle',
      ),
    ).toBe('state');
    expect(
      resolvePresentationFieldName(
        {
          title: 'Add iframe plugin',
          _parent: { full_name: 'RoadieHQ/tech-interviews' },
        },
        'RoadieHQ/tech-interviews',
        'subtitle',
      ),
    ).toBe('full name');
  });
});
