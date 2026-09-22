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
  createServiceRef,
  createServiceFactory,
} from '@roadiehq/extensions-api';

export interface SubjectScopeIndex {
  record(input: {
    subjectType: string;
    subjectId: string;
    scopeId: string;
  }): Promise<void>;
  remove(input: {
    subjectType: string;
    subjectId: string;
    scopeId: string;
  }): Promise<void>;
  lookupScopeIds(input: {
    subjectType: string;
    subjectId: string;
  }): Promise<string[]>;
}

export const noopSubjectScopeIndex: SubjectScopeIndex = {
  async record() {},
  async remove() {},
  async lookupScopeIds() {
    return [];
  },
};

export const subjectScopeIndexServiceRef = createServiceRef<SubjectScopeIndex>({
  id: 'integrations.subjectScopeIndex',
  scope: 'plugin',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: {},
      async factory() {
        return noopSubjectScopeIndex;
      },
    }),
});
