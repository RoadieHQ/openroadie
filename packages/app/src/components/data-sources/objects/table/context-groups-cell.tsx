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

import { Link } from 'react-router';
import { contextGroupInstance } from '../../../../config/paths';
import type { DataSourceObjectRow } from '../use-data-source-objects';
import { CellTooltip } from './cell-tooltip';

export function ContextGroupsCell({
  groups,
}: {
  groups: DataSourceObjectRow['contextGroups'];
}) {
  const uniqueGroups = Array.from(
    new Map((groups ?? []).map(group => [group.title, group])).values(),
  );
  const sortedGroups = uniqueGroups.sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  if (sortedGroups.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const tooltipLabel = sortedGroups.map(group => group.title).join(', ');

  return (
    <CellTooltip label={tooltipLabel}>
      {/* The links need no stopPropagation: the row's handler already ignores
          clicks that land on an `a` (see rowClickFromInteractiveTarget). */}
      <div className="flex min-w-0 flex-nowrap gap-1 overflow-hidden">
        {sortedGroups.map(group => (
          <Link
            key={group.groupId}
            to={contextGroupInstance(group.groupId)}
            className="motion-colors inline-flex shrink-0 rounded-full border border-border bg-muted/45 px-2 py-0.5 text-2xs whitespace-nowrap text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          >
            <span>{group.title}</span>
          </Link>
        ))}
      </div>
    </CellTooltip>
  );
}
