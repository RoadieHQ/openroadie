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

const seeds = loadSeeds('openai');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a real (single-member) organization: counts only.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-openai',
    slug: 'openai',
    name: 'OpenAI Admin',
    type: 'other',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'Bearer ${OPENAI_ADMIN_KEY}' },
    },
  },
  secrets: { OPENAI_ADMIN_KEY: 'dummy-openai-admin-key' },
  cases: [
    {
      seed: seedByName(seeds, 'OpenAI organization users'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'OpenAI projects'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'OpenAI project members'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'OpenAI project API keys'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'OpenAI project service accounts'),
      expectedCount: 0,
    },
  ],
});
