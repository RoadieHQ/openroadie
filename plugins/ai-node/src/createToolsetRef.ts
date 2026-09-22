/*
 * Copyright 2020 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/frontend-plugin-api/src/apis/system/ApiRef.ts at v1.47.1, and modified.
 */

import { ToolsetRef } from './definitions';

/**
 * AI Toolset reference configuration - holds an ID of the referenced API.
 *
 * @public
 */
export type ToolsetRefConfig = {
  id: string;
};

class ToolsetRefImpl implements ToolsetRef {
  constructor(private readonly config: ToolsetRefConfig) {
    const valid = config.id
      .split('.')
      .flatMap(part => part.split('-'))
      .every(part => part.match(/^[a-z][a-z0-9]*$/));
    if (!valid) {
      throw new Error(
        `AI Toolset id must only contain period separated lowercase alphanum tokens with dashes, got '${config.id}'`,
      );
    }
  }

  get id(): string {
    return this.config.id;
  }

  toString() {
    return `aiToolsetRef{${this.config.id}}`;
  }
}

/**
 * Creates a reference to an AI Toolset.
 *
 * @param config - The descriptor of the AI Toolset to reference.
 * @returns An AI Tool reference.
 * @public
 */
export function createToolsetRef(config: ToolsetRefConfig): ToolsetRef {
  return new ToolsetRefImpl(config);
}
