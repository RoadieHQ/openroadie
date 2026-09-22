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
import { EventEmitter } from 'events';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

const CHANGED = 'datasource-changed';
// Kept separate from CHANGED on purpose: relationship edges changing is not an
// object-data change, so it must not fan out to webhooks or the extension-point
// listeners — only to consumers that derive state from edges (context groups).
const RELATIONSHIPS_CHANGED = 'relationships-changed';
export type DatasourceEventListener = (
  datasourceId: string,
  workspaceId: string,
) => void;

export class DatasourceEvents {
  private readonly emitter = new EventEmitter();

  emitChanged(datasourceId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
    this.emitter.emit(CHANGED, datasourceId, workspaceId);
  }

  onChanged(
    listener: DatasourceEventListener,
    workspaceId?: string,
  ): () => void {
    const scopedListener: DatasourceEventListener = (
      datasourceId,
      eventWorkspaceId,
    ) => {
      if (workspaceId && workspaceId !== eventWorkspaceId) {
        return;
      }
      listener(datasourceId, eventWorkspaceId);
    };
    this.emitter.on(CHANGED, scopedListener);
    return () => this.emitter.off(CHANGED, scopedListener);
  }

  emitRelationshipsChanged(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): void {
    this.emitter.emit(RELATIONSHIPS_CHANGED, datasourceId, workspaceId);
  }

  onRelationshipsChanged(listener: DatasourceEventListener): () => void {
    this.emitter.on(RELATIONSHIPS_CHANGED, listener);
    return () => this.emitter.off(RELATIONSHIPS_CHANGED, listener);
  }
}
