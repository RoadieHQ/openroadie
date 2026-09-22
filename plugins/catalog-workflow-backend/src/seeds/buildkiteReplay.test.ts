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

const seeds = loadSeeds('buildkite');
const hasFixtureAccess = await probeFixtureAccess();

// Buildkite recordings come from a real organization: assert counts only so
// no org-identifying values land in the repo.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-buildkite',
    slug: 'buildkite',
    name: 'Buildkite',
    type: 'ci-cd',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'Bearer ${BUILDKITE_TOKEN}' },
    },
  },
  secrets: { BUILDKITE_TOKEN: 'dummy-buildkite-token' },
  cases: [
    {
      seed: seedByName(seeds, 'Buildkite organizations'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Buildkite pipelines (all organizations)'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Buildkite teams (all organizations)'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Buildkite builds (per pipeline)'),
      expectedCount: 0,
    },
  ],
});
