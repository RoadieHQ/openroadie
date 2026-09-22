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

import type { ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@roadiehq/ui/tooltip';

/**
 * Long enough that scanning across a dense table doesn't trail tooltips, short
 * enough that pausing on a truncated cell reveals it. Also the delay on the
 * table's own `TooltipProvider`, so nested triggers stay consistent.
 */
export const CELL_TOOLTIP_DELAY_MS = 500;

/** Reveals a truncated cell's full value on hover. */
export function CellTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip delayDuration={CELL_TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-h-64 max-w-sm overflow-y-auto break-words whitespace-normal"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
