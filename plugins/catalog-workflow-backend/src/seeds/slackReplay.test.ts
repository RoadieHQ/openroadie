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

const seeds = loadSeeds('slack');
const hasFixtureAccess = await probeFixtureAccess();

// User groups is 0: a paid-plan feature — the free-plan API returns an
// empty list, which still verifies auth + endpoint shape.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-slack',
    slug: 'slack',
    name: 'Slack',
    type: 'communication',
    authType: 'bearer-token',
    authConfig: { token: '${SLACK_BOT_TOKEN}' },
  },
  secrets: { SLACK_BOT_TOKEN: 'dummy-slack-token' },
  cases: [
    {
      seed: seedByName(seeds, 'Slack users'),
      expectedCount: 4,
    },
    {
      seed: seedByName(seeds, 'Slack channels'),
      expectedCount: 4,
    },
    {
      seed: seedByName(seeds, 'Slack user groups'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Slack channel members (per channel)'),
      expectedCount: 5,
    },
  ],
});
