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

const seeds = loadSeeds('anthropic');
const hasFixtureAccess = await probeFixtureAccess();

// Recordings come from a real (single-member) organization: counts only.
runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-anthropic',
    slug: 'anthropic',
    name: 'Anthropic Admin',
    type: 'other',
    authType: 'header',
    authConfig: {
      headers: { 'x-api-key': '${ANTHROPIC_ADMIN_KEY}' },
    },
  },
  secrets: { ANTHROPIC_ADMIN_KEY: 'dummy-anthropic-admin-key' },
  cases: [
    {
      seed: seedByName(seeds, 'Anthropic organization members'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'Anthropic workspaces'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Anthropic workspace members'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Anthropic API keys'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Anthropic organization invites'),
      expectedCount: 0,
    },
  ],
});
