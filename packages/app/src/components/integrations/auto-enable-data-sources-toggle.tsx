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

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@roadiehq/ui/collapsible';
import { Switch } from '@roadiehq/ui/switch';
import { cn } from '@roadiehq/ui/utils';

export interface AutoEnableDataSourcesToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  seedNames: string[];
}

export function AutoEnableDataSourcesToggle({
  checked,
  onCheckedChange,
  seedNames,
}: AutoEnableDataSourcesToggleProps) {
  const [expanded, setExpanded] = useState(false);
  const count = seedNames.length;

  return (
    <div className="mb-5 flex items-start justify-between gap-3 rounded-md border border-divider bg-muted/20 p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          Automatically enable data sources
        </span>
        <span className="text-xs text-muted-foreground">
          After saving, enable this integration&apos;s pre-built data sources
          once each one passes a dry-run.
        </span>
        {count > 0 && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1.5 h-auto w-fit px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    'motion-transform-standard size-3.5',
                    expanded && 'rotate-90',
                  )}
                />
                {expanded ? 'Hide' : 'Show'} {count} data source
                {count === 1 ? '' : 's'}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1.5 space-y-1 pl-1">
                {seedNames.map(name => (
                  <li
                    key={name}
                    className="text-xs leading-snug text-muted-foreground"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      <Switch
        className="mt-0.5 shrink-0"
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label="Automatically enable data sources"
      />
    </div>
  );
}
