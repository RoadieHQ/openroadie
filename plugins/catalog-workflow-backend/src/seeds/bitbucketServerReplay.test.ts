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

const seeds = loadSeeds('bitbucket-server');
const hasFixtureAccess = await probeFixtureAccess();

runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-bitbucket-server',
    slug: 'bitbucket-server',
    name: 'Bitbucket Server',
    type: 'scm',
    authType: 'basic',
    authConfig: {
      username: '${BITBUCKET_SERVER_USERNAME}',
      password: '${BITBUCKET_SERVER_TOKEN}',
    },
  },
  secrets: {
    BITBUCKET_SERVER_USERNAME: 'dummy-bitbucket-server-user',
    BITBUCKET_SERVER_TOKEN: 'dummy-bitbucket-server-token',
  },
  cases: [
    {
      seed: seedByName(seeds, 'Bitbucket Server projects'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Bitbucket Server repositories'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'Bitbucket Server repositories (per project)'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'Bitbucket Server pull requests (per repo)'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Bitbucket Server users'),
      expectedCount: 2,
    },
  ],
});
