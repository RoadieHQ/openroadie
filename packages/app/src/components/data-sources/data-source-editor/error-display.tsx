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

import React, { useState } from 'react';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@roadiehq/ui/collapsible';
import { AlertCircle } from 'lucide-react';
import {
  formatErrorString,
  parseExecutionError,
} from '../../../api/workflow/parse-execution-error';
import { CopyButton } from '@roadiehq/ui/copy-button';

export interface ErrorDisplayProps {
  error: unknown;
  title?: string;
  variant?: 'card' | 'inline';
}

export function ErrorDisplay({
  error,
  title = 'Execution Failed',
  variant = 'card',
}: ErrorDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const errorString = formatErrorString(error);
  const parsed = parseExecutionError(errorString);
  const hasDetails = parsed.details !== parsed.summary;

  if (variant === 'inline') {
    return (
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <p className="text-sm font-medium text-destructive">{parsed.summary}</p>
        {parsed.suggestion && (
          <span className="text-xs text-muted-foreground">
            {parsed.suggestion}
          </span>
        )}
        {hasDetails && (
          <CollapsibleTrigger asChild>
            <span className="mt-1 block cursor-pointer text-xs text-destructive hover:underline">
              {expanded ? 'Hide details' : 'Show details'}
            </span>
          </CollapsibleTrigger>
        )}
        {hasDetails && (
          <CollapsibleContent>
            <span className="mt-1 block max-h-[200px] overflow-auto font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
              {parsed.details}
            </span>
          </CollapsibleContent>
        )}
      </Collapsible>
    );
  }

  return (
    <div className="mt-2 px-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <h5 className="font-medium tracking-tight text-destructive">
            {title}
          </h5>
        </div>
        <TooltipProvider>
          <CopyButton value={errorString} label="Copy error" />
        </TooltipProvider>
      </div>
      <p className="mt-2 text-sm text-foreground">{parsed.summary}</p>
      {parsed.suggestion && (
        <p className="mt-1 text-xs text-muted-foreground">
          {parsed.suggestion}
        </p>
      )}
      {hasDetails && (
        <p className="mt-3 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {parsed.details}
        </p>
      )}
    </div>
  );
}
