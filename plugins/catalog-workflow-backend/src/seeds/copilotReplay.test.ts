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

const seeds = loadSeeds('github');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from real orgs with a Copilot subscription but no active
// seats: billing summaries exist (one per org), seat lists are empty. The
// metrics report endpoint 403s on orgs without active usage — live runs
// tolerated that, and the missing fixture (mock 404) must replay the same
// tolerant path.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-github-token',
    slug: 'github-token',
    name: 'GitHub (Token)',
    type: 'scm',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'token ${GITHUB_TOKEN}' },
    },
  },
  secrets: { GITHUB_TOKEN: 'dummy-github-token' },
  cases: [
    {
      seed: seedByName(seeds, 'GitHub Copilot billing summary'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'GitHub Copilot seats'),
      expectedCount: 0,
    },
  ],
});
