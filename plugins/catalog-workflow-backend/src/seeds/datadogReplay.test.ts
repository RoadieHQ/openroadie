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

const seeds = loadSeeds('datadog');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a fresh trial org seeded with one monitor and one
// dashboard: counts only. SLOs, service definitions, and teams verified
// empty; team memberships chain off teams and stay empty with them.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-datadog',
    slug: 'datadog',
    name: 'Datadog',
    type: 'monitoring',
    authType: 'header',
    authConfig: {
      headers: {
        'DD-API-KEY': '${DD_API_TOKEN}',
        'DD-APPLICATION-KEY': '${DD_APP_TOKEN}',
      },
    },
  },
  secrets: {
    DD_API_TOKEN: 'dummy-dd-api',
    DD_APP_TOKEN: 'dummy-dd-app',
  },
  cases: [
    {
      seed: seedByName(seeds, 'Datadog monitors'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Datadog dashboards'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Datadog SLOs'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Datadog service definitions'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Datadog teams'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Datadog team memberships'),
      expectedCount: 0,
    },
  ],
});
