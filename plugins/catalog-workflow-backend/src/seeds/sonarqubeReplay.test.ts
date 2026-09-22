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

const seeds = loadSeeds('sonarqube');
const hasFixtureAccess = await probeFixtureAccess();

runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-sonarqube',
    slug: 'sonarqube',
    name: 'SonarQube',
    type: 'security',
    authType: 'header',
    authConfig: {
      headers: { Authorization: 'Bearer ${SONARQUBE_API_TOKEN}' },
    },
  },
  secrets: { SONARQUBE_API_TOKEN: 'dummy-sonarqube-token' },
  cases: [
    {
      seed: seedByName(seeds, 'SonarQube projects'),
      expectedCount: 1,
      assertFields: items => {
        expect(
          findRecord(items, item => item.key === 'mock-integrations'),
        ).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'SonarQube issues (per project)'),
      expectedCount: 7,
    },
    {
      seed: seedByName(seeds, 'SonarQube branches (per project)'),
      expectedCount: 1,
    },
    {
      seed: seedByName(seeds, 'SonarQube quality gates'),
      expectedCount: 1,
      assertFields: items => {
        expect(
          findRecord(items, item => item.name === 'Sonar way'),
        ).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'SonarQube metrics'),
      expectedCount: 155,
    },
  ],
});
