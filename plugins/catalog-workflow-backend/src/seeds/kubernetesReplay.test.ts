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
  metadataName,
  probeFixtureAccess,
  runReplayCases,
  seedByName,
} from './replayHarness.test-utils';

const seeds = loadSeeds('kubernetes');
const hasFixtureAccess = await probeFixtureAccess();

runReplayCases(hasFixtureAccess, {
  integration: {
    id: 'integration-kubernetes',
    slug: 'kubernetes',
    name: 'Kubernetes',
    type: 'infrastructure',
    authType: 'bearer-token',
    authConfig: { token: '${K8S_SA_TOKEN}' },
  },
  secrets: { K8S_SA_TOKEN: 'dummy-k8s-token' },
  cases: [
    {
      seed: seedByName(seeds, 'Kubernetes namespaces'),
      expectedCount: 6,
      assertFields: items => {
        expect(
          findRecord(items, item => metadataName(item) === 'demo'),
        ).toBeDefined();
      },
    },
    {
      seed: seedByName(seeds, 'Kubernetes deployments (all namespaces)'),
      expectedCount: 4,
    },
    {
      seed: seedByName(seeds, 'Kubernetes services (all namespaces)'),
      expectedCount: 2,
    },
    {
      seed: seedByName(seeds, 'Kubernetes ingresses (all namespaces)'),
      expectedCount: 0,
    },
    {
      seed: seedByName(seeds, 'Kubernetes custom resource definitions'),
      expectedCount: 0,
    },
  ],
});
