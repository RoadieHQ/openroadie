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

const seeds = loadSeeds('incident');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a fresh trial org (viewer-scoped key, so no test
// incidents could be created): defaults only.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-incident',
    slug: 'incident',
    name: 'incident.io',
    type: 'incident-management',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'Bearer ${INCIDENT_API_KEY}' },
    },
  },
  secrets: { INCIDENT_API_KEY: 'dummy-incident-key' },
  cases: [
    {
      seed: seedByName(seeds, 'incident.io severities'),
      expectedCount: 3,
    },
    {
      seed: seedByName(seeds, 'incident.io incident roles'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'incident.io users'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'incident.io incidents'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'incident.io follow-ups (per incident)'),
      expectedCount: 0,
    },
  ],
});
