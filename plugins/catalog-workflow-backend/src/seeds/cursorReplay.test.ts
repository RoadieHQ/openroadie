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
import {
  loadSeeds,
  probeFixtureAccess,
  runReplayCases,
  seedByName,
} from './replayHarness.test-utils';

const seeds = loadSeeds('cursor');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from the real team: counts only. The usage and audit
// windows are rolling 7-day POST bodies, so their fixtures rely on the mock
// server's URL-key fallback rather than a body hash (dates never re-match).
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-cursor',
    slug: 'cursor',
    name: 'Cursor Admin',
    type: 'analytics',
    authType: 'basic',
    authConfig: {
      username: '${CURSOR_ADMIN_API_KEY}',
      password: '',
    },
  },
  secrets: { CURSOR_ADMIN_API_KEY: 'dummy-cursor-key' },
  cases: [
    {
      seed: seedByName(seeds, 'Cursor team members'),
      expectedCount: 10,
    },
    {
      seed: seedByName(seeds, 'Cursor member spend'),
      expectedCount: 9,
    },
    {
      seed: seedByName(seeds, 'Cursor daily usage (last 7 days)'),
      expectedCount: 32,
    },
    {
      seed: seedByName(seeds, 'Cursor audit logs (last 7 days)'),
      expectedCount: 5,
    },
  ],
});
