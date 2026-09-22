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

/** Clicks on nested controls should not also trigger row navigation. */
const ROW_CLICK_IGNORE_SELECTOR =
  'a, button, input, select, textarea, [role="button"], [role="menuitem"], [data-no-row-click]';

/**
 * True when a row-level click actually landed on one of the row's own controls
 * — the title link, a row action, a toggle — which owns that click itself.
 *
 * Shared so every listing answers this the same way, including the bespoke
 * datastore objects table that owns its own row handler rather than going
 * through `OverviewTable`. A cell reaching for `stopPropagation` instead is a
 * sign it didn't know about this guard.
 */
export function rowClickFromInteractiveTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element && !!target.closest(ROW_CLICK_IGNORE_SELECTOR)
  );
}
