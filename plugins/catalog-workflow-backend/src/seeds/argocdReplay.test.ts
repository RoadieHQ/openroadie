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
import { expect } from 'vitest';
import {
  findRecord,
  loadSeeds,
  metadataName,
  probeFixtureAccess,
  runReplayCases,
  seedByName,
} from './replayHarness.test-utils';

const seeds = loadSeeds('argocd');
const hasFixtureAccess = await probeFixtureAccess();

runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-argocd',
    slug: 'argocd',
    name: 'Argo CD',
    type: 'ci-cd',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'Bearer ${ARGOCD_TOKEN}' },
    },
  },
  secrets: { ARGOCD_TOKEN: 'dummy-argocd-token' },
  cases: [
    {
      seed: seedByName(seeds, 'Argo CD applications'),
      expectedCount: 1,
      assertFields: items => {
        expect(
          findRecord(items, item => metadataName(item) === 'guestbook'),
        ).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'Argo CD projects'),
      expectedCount: 1,
      assertFields: items => {
        expect(
          findRecord(items, item => metadataName(item) === 'default'),
        ).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'Argo CD clusters'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Argo CD repositories'),
      expectedCount: 1,
      assertFields: items => {
        expect(
          findRecord(
            items,
            item =>
              item.repo ===
              'https://github.com/argoproj/argocd-example-apps.git',
          ),
        ).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'Argo CD applications (per project)'),
      expectedCount: 1,
      assertFields: items => {
        expect(
          findRecord(items, item => metadataName(item) === 'guestbook'),
        ).toBeDefined();
      },
    },
  ],
});
