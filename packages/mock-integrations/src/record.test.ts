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
import { describe, expect, it } from 'vitest';
import { logsToFixtures } from './record';

const HOSTS = new Map([
  ['https://127.0.0.1:6443', 'kubernetes'],
  ['https://auth.app.wiz.io', 'wiz'],
]);

describe('logsToFixtures', () => {
  it('converts request logs into fixture entries, skipping failures and masking tokens', () => {
    const logs = [
      {
        target: 'https://127.0.0.1:6443/api/v1/pods?limit=500',
        operation: 'GET',
        status: '200',
        responseBody: { items: [{ metadata: { name: 'pod-a' } }] },
      },
      {
        // failed request — not a replayable fixture
        target: 'https://127.0.0.1:6443/api/v1/secrets',
        operation: 'GET',
        status: '403',
        error: 'Forbidden',
      },
      {
        // oauth exchange — the real token must never land in a fixture
        target: 'https://auth.app.wiz.io/oauth/token',
        operation: 'POST',
        status: '200',
        responseBody: { access_token: 'real-secret-token', expires_in: 3600 },
      },
      {
        // unknown host — not one of ours, dropped
        target: 'https://example.com/other',
        operation: 'GET',
        status: '200',
        responseBody: {},
      },
    ];

    const { fixtures, skipped } = logsToFixtures(logs, HOSTS);

    expect(fixtures).toEqual([
      {
        key: 'kubernetes/GET/api/v1/pods__limit=500.json',
        response: {
          status: 200,
          body: { items: [{ metadata: { name: 'pod-a' } }] },
        },
      },
      {
        key: 'wiz/POST/oauth/token.json',
        response: {
          status: 200,
          body: { access_token: 'mock-token', expires_in: 3600 },
        },
      },
    ]);
    expect(skipped).toBe(2);
  });

  it('keeps the first response when the same request repeats', () => {
    const logs = [
      {
        target: 'https://127.0.0.1:6443/api/v1/pods',
        operation: 'GET',
        status: '200',
        responseBody: { page: 1 },
      },
      {
        target: 'https://127.0.0.1:6443/api/v1/pods',
        operation: 'GET',
        status: '200',
        responseBody: { page: 2 },
      },
    ];

    const { fixtures } = logsToFixtures(logs, HOSTS);
    expect(fixtures).toEqual([
      {
        key: 'kubernetes/GET/api/v1/pods.json',
        response: { status: 200, body: { page: 1 } },
      },
    ]);
  });

  it('writes Link response headers into fixture responses', () => {
    const link = '<https://127.0.0.1:6443/api/v1/pods?page=2>; rel="next"';
    const logs = [
      {
        target: 'https://127.0.0.1:6443/api/v1/pods',
        operation: 'GET',
        status: '200',
        responseBody: { items: [{ metadata: { name: 'pod-a' } }] },
        responseHeaders: { link },
      },
    ];

    const { fixtures } = logsToFixtures(logs, HOSTS);

    expect(fixtures).toEqual([
      {
        key: 'kubernetes/GET/api/v1/pods.json',
        response: {
          status: 200,
          body: { items: [{ metadata: { name: 'pod-a' } }] },
          headers: { link },
        },
      },
    ]);
  });
});
