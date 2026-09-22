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

const seeds = loadSeeds('sentry');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from real Sentry orgs: counts plus one stable org slug.
// The issues recording spans a paginated project (100 + 68 across two link
// pages) — the count doubles as a regression guard for the mutable-sort
// duplicate-id bug the sort=new fix resolved.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-sentry',
    slug: 'sentry',
    name: 'Sentry',
    type: 'monitoring',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'Bearer ${SENTRY_AUTH_TOKEN}' },
    },
  },
  secrets: { SENTRY_AUTH_TOKEN: 'dummy-sentry-token' },
  cases: [
    {
      seed: seedByName(seeds, 'Sentry organizations (all organizations)'),
      expectedCount: 3,
      assertFields: items => {
        expect(findRecord(items, item => item.slug === 'roadie')).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'Sentry teams (all organizations)'),
      expectedCount: 3,
    },
    {
      seed: seedByName(seeds, 'Sentry projects (all organizations)'),
      expectedCount: 5,
    },
    {
      seed: seedByName(seeds, 'Sentry members (all organizations)'),
      expectedCount: 12,
    },
    {
      seed: seedByName(seeds, 'Sentry issues (per project)'),
      expectedCount: 169,
    },
  ],
});
