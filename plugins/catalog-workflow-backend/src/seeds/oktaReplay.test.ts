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

const seeds = loadSeeds('okta');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a fresh trial org: counts only.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-okta',
    slug: 'okta',
    name: 'Okta',
    type: 'infrastructure',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'SSWS ${OKTA_TOKEN}' },
    },
  },
  secrets: { OKTA_TOKEN: 'dummy-okta-token' },
  cases: [
    {
      seed: seedByName(seeds, 'Okta users'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Okta groups'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'Okta group members'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Okta applications'),
      expectedCount: 5,
    },
  ],
});
