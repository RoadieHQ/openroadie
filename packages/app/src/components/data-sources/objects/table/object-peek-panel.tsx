/*
 * Copyright 2025 Larder Software Limited
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

import { Suspense, lazy } from 'react';
import { Spinner } from '@roadiehq/ui/spinner';
import { formatAbsolute, formatRelative } from '../../../common';

// Reuse the editor data tab's JSON viewer; lazy so react-json-view only loads
// when a row is actually expanded.
const SchemaViewer = lazy(() =>
  import('../../data-source-editor/schema-viewer').then(module => ({
    default: module.SchemaViewer,
  })),
);

/**
 * Lean inline "peek" at an object's raw payload — the fast, in-place look that
 * keeps you at your scroll position and lets you expand several rows to compare.
 * Deliberately just the JSON + timestamps: the richer structured view (identity,
 * context groups, relationships) lives in the side drawer opened by a row-body
 * click, and the full routed page is the drawer's "Open" action. Keeping the
 * three surfaces non-overlapping is what stops them feeling redundant.
 */
export function ObjectPeekPanel({
  object,
  createdAt,
  updatedAt,
}: {
  object: unknown;
  createdAt: string;
  updatedAt: string;
}) {
  const created = createdAt ? formatRelative(createdAt) : null;
  const updated = updatedAt ? formatRelative(updatedAt) : null;
  return (
    <div className="px-3 py-3">
      {/* SchemaViewer's toolbar uses Radix tooltips; the whole table is wrapped
          in a TooltipProvider, so it needs no provider of its own. */}
      <Suspense
        fallback={
          <div className="flex min-h-24 items-center justify-center">
            <Spinner size={16} />
          </div>
        }
      >
        <SchemaViewer output={[object]} maxHeight={420} />
      </Suspense>
      {created || updated ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {created ? (
            <span title={formatAbsolute(createdAt)}>Created {created}</span>
          ) : null}
          {updated ? (
            <span title={formatAbsolute(updatedAt)}>Updated {updated}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
