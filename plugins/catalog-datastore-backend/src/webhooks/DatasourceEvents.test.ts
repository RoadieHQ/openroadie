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
import { vi } from 'vitest';
import type { DatasourceChangedListener } from '../extensions';
import { DatasourceEvents } from './DatasourceEvents';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

describe('DatasourceEvents', () => {
  it('keeps the changed and relationships-changed channels separate', () => {
    // Webhooks and the extension-point listeners subscribe to `changed`; edge
    // writes must not fan out to them, only to relationships-changed
    // consumers (context groups).
    const events = new DatasourceEvents();
    const onChanged = vi.fn();
    const onRelationshipsChanged = vi.fn();
    events.onChanged(onChanged);
    events.onRelationshipsChanged(onRelationshipsChanged);

    events.emitRelationshipsChanged('ds-1');
    expect(onRelationshipsChanged).toHaveBeenCalledWith(
      'ds-1',
      DEFAULT_WORKSPACE_ID,
    );
    expect(onChanged).not.toHaveBeenCalled();

    events.emitChanged('ds-2');
    expect(onChanged).toHaveBeenCalledWith('ds-2', DEFAULT_WORKSPACE_ID);
    expect(onRelationshipsChanged).toHaveBeenCalledTimes(1);
  });

  it('carries the workspace on changed events', () => {
    const events = new DatasourceEvents();
    const listener = vi.fn<DatasourceChangedListener>();
    events.onChanged(listener);

    events.emitChanged('shared-datasource', 'workspace-b');

    expect(listener).toHaveBeenCalledWith('shared-datasource', 'workspace-b');
  });

  it('filters changed events for workspace-scoped listeners', () => {
    const events = new DatasourceEvents();
    const listener = vi.fn<DatasourceChangedListener>();
    events.onChanged(listener, 'workspace-a');

    events.emitChanged('shared-datasource', 'workspace-b');
    events.emitChanged('shared-datasource', 'workspace-a');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('shared-datasource', 'workspace-a');
  });

  it('unsubscribes relationships-changed listeners', () => {
    const events = new DatasourceEvents();
    const listener = vi.fn();
    const unsubscribe = events.onRelationshipsChanged(listener);

    unsubscribe();
    events.emitRelationshipsChanged('ds-1');

    expect(listener).not.toHaveBeenCalled();
  });
});
