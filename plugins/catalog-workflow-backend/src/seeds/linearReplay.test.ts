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
  probeFixtureAccess,
  runReplayCases,
  seedByName,
} from './replayHarness.test-utils';

const seeds = loadSeeds('linear');
const hasFixtureAccess = await probeFixtureAccess();

// Linear is GraphQL: every workflow POSTs to /graphql and fixtures are
// disambiguated by the request-body hash (mock-integrations body keying).
// Recordings come from a real workspace: count-only assertions plus one
// stable team key, no user/issue content in the repo.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-linear',
    slug: 'linear',
    name: 'Linear',
    type: 'project-management',
    authType: 'header',
    authConfig: {
      headers: { Authorization: '${LINEAR_API_KEY}' },
    },
  },
  secrets: { LINEAR_API_KEY: 'dummy-linear-key' },
  cases: [
    {
      seed: seedByName(seeds, 'Linear teams'),
      expectedCount: 1,
      assertFields: items => {
        expect(findRecord(items, item => item.key === 'SAU')).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'Linear users'),
      expectedCount: 5,
    },
    {
      seed: seedByName(seeds, 'Linear projects'),
      expectedCount: 3,
    },
    {
      seed: seedByName(seeds, 'Linear issues'),
      expectedCount: 65,
    },
    {
      seed: seedByName(seeds, 'Linear issues (per team)'),
      expectedCount: 65,
    },
  ],
});
