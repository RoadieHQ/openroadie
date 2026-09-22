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

import type { WorkflowEdge } from '@roadiehq/catalog-workflow-common';
import type { PagedDataPlane } from './data-plane';
import { buildNodeInputs } from './input-streams';
import type { NodeIO, PagedItems } from './types';

export function createNodeIO(options: {
  nodeId: string;
  edges: readonly WorkflowEdge[];
  plane: PagedDataPlane;
}): NodeIO {
  const { nodeId, edges, plane } = options;
  return {
    inputs: buildNodeInputs({ nodeId, edges, plane }),
    emit: (items: PagedItems) => plane.writePage(nodeId, items),
  };
}
