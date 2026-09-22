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
import { expect } from 'vitest';
import {
  findRecord,
  loadSeeds,
  probeFixtureAccess,
  runReplayCases,
  seedByName,
} from './replayHarness.test-utils';

const seeds = loadSeeds('jira');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a throwaway Atlassian Cloud site (roadie-test-team):
// counts plus one stable project key.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-jira',
    slug: 'jira',
    name: 'Jira',
    type: 'project-management',
    authType: 'basic',
    authConfig: {
      username: '${JIRA_EMAIL}',
      password: '${JIRA_API_TOKEN}',
    },
  },
  secrets: {
    JIRA_EMAIL: 'dummy@example.com',
    JIRA_API_TOKEN: 'dummy-jira-token',
  },
  cases: [
    {
      seed: seedByName(seeds, 'Jira projects'),
      expectedCount: 2,
      assertFields: items => {
        expect(findRecord(items, item => item.key === 'KAN')).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'Jira users'),
      expectedCount: 41,
    },
    {
      seed: seedByName(seeds, 'Jira boards'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'Jira issues (per project)'),
      expectedCount: 10,
    },
    {
      seed: seedByName(seeds, 'Jira sprints (per scrum board)'),
      expectedCount: 0,
    },
  ],
});
