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

const seeds = loadSeeds('bitbucket-cloud');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a test workspace (roadie-test-2): one member, two
// demo repos, one open PR.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-bitbucket-cloud',
    slug: 'bitbucket-cloud',
    name: 'Bitbucket Cloud',
    type: 'scm',
    authType: 'basic',
    authConfig: {
      username: '${BITBUCKET_USER}',
      password: '${BITBUCKET_APP_PASSWORD}',
    },
    config: { workspace: 'roadie-test-2' },
  },
  secrets: {
    BITBUCKET_USER: 'dummy-bitbucket-user',
    BITBUCKET_APP_PASSWORD: 'dummy-bitbucket-app-password',
  },
  cases: [
    {
      seed: seedByName(seeds, 'Bitbucket Cloud workspaces'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Bitbucket Cloud repositories'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'Bitbucket Cloud pull requests (per repo)'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Bitbucket Cloud workspace members'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Bitbucket Cloud projects'),
      expectedCount: 2,
    },
  ],
});
