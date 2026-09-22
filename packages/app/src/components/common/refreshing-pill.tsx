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

import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';

export interface RefreshingPillProps {
  className?: string;
}

/**
 * The "keep what's on screen, show that something is happening" indicator for a
 * refetch that isn't a first load — paginating, sorting, filtering, refreshing
 * (loading-states rule #5, which forbids flashing a skeleton here).
 *
 * `role="status"` so the transition is announced once rather than silently
 * leaving stale content on screen.
 */
export function RefreshingPill({ className }: RefreshingPillProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground shadow-sm',
        className,
      )}
    >
      <Spinner className="size-3" />
      Loading…
    </div>
  );
}
