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

const seeds = loadSeeds('dynatrace');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a fresh trial environment with no monitored hosts:
// every collection is legitimately empty. The value here is auth + endpoint
// shape (classic Environment API v2/v1, Api-Token scheme).
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-dynatrace',
    slug: 'dynatrace',
    name: 'Dynatrace',
    type: 'monitoring',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'Api-Token ${DYNATRACE_API_TOKEN}' },
    },
  },
  secrets: { DYNATRACE_API_TOKEN: 'dummy-dynatrace-token' },
  cases: [
    { seed: seedByName(seeds, 'Dynatrace hosts'), expectedCount: 0 },
    { seed: seedByName(seeds, 'Dynatrace services'), expectedCount: 0 },
    {
      seed: seedByName(seeds, 'Dynatrace problems (last 30 days)'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Dynatrace synthetic monitors'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Dynatrace synthetic monitor details'),
      expectedCount: 0,
    },
  ],
});
