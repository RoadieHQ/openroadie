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
import { Database } from 'lucide-react';
import humanizeDuration from 'humanize-duration';
import { IntegrationIconFrame, IntegrationLogo } from '@roadiehq/ui/item-list';
import {
  StatusDot,
  type StatusIndicatorTone,
} from '@roadiehq/ui/status-indicator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { EXECUTION, toExecutionOutcome } from '../../overview';
import { dataSourceDetail } from '../../../config/paths';
import type { DataSourceItem } from '../types';

interface DataSourceContextHeaderProps {
  dataSource: DataSourceItem;
  total: number;
  searchActive: boolean;
}

const exactTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** "2 hours" / "3 days" — mirrors the wording in the overview's last-run cell. */
function humanizeAgo(lastRunAt: string): string {
  const ms = Date.now() - new Date(lastRunAt).getTime();
  return humanizeDuration(ms, { largest: 1, round: true });
}

interface LastRunDisplay {
  tone: StatusIndicatorTone;
  /** Extra dot classes; "never ran" dims the neutral dot rather than recolouring it. */
  dotClassName?: string;
  /** Pulse the dot for an in-flight run. */
  pulse?: boolean;
  label: string;
  tooltip?: string;
}

/** Encodes the data source's last-run outcome the same way the overview does. */
function getLastRunDisplay(dataSource: DataSourceItem): LastRunDisplay {
  const execution = dataSource.execution?.isDryRun
    ? undefined
    : dataSource.execution;
  const lastRunAt = execution?.lastRunAt;

  const outcome = toExecutionOutcome({
    status: execution?.status,
    objectCount: execution?.objectCount,
    lastRunAt,
  });

  if (outcome === 'running') {
    return { tone: 'neutral', pulse: true, label: 'Running…' };
  }

  if (outcome === 'never') {
    return {
      tone: 'neutral',
      dotClassName: 'bg-muted-foreground/40',
      label: EXECUTION.never.label,
    };
  }

  const ago = humanizeAgo(lastRunAt as string);
  const tooltip = exactTimeFormatter.format(new Date(lastRunAt as string));

  if (outcome === 'failed') {
    return { tone: 'destructive', label: `Failed ${ago} ago`, tooltip };
  }
  return {
    tone: outcome === 'partial' ? 'warning' : 'success',
    label: `Last run ${ago} ago`,
    tooltip,
  };
}

function Separator() {
  return (
    <span
      aria-hidden
      className="text-sm leading-none font-semibold text-muted-foreground"
    >
      ·
    </span>
  );
}

/**
 * Subtle inline strip rendered under the page header — `[icon] name · N objects
 * · ● last run` — using the overview's name + last-run idioms at small size.
 */
export function DataSourceContextHeader({
  dataSource,
  total,
  searchActive,
}: DataSourceContextHeaderProps) {
  const lastRun = getLastRunDisplay(dataSource);
  const countLabel = searchActive
    ? `${total.toLocaleString()} result${total === 1 ? '' : 's'}`
    : `${total.toLocaleString()} object${total === 1 ? '' : 's'}`;

  const lastRunChip = (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot
        tone={lastRun.tone}
        pulse={lastRun.pulse}
        className={cn('size-1.5', lastRun.dotClassName)}
      />
      <span className="whitespace-nowrap">{lastRun.label}</span>
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <Link
        to={dataSourceDetail(dataSource.id)}
        className="inline-flex min-w-0 items-center gap-1.5 text-foreground hover:underline"
      >
        <IntegrationIconFrame size="mini">
          {dataSource.logoUrl ? (
            <IntegrationLogo src={dataSource.logoUrl} size={12} />
          ) : (
            <Database className="size-3 shrink-0 text-muted-foreground" />
          )}
        </IntegrationIconFrame>
        <span className="truncate font-medium">{dataSource.name}</span>
      </Link>
      <Separator />
      <span className="tabular-nums">{countLabel}</span>
      <Separator />
      {lastRun.tooltip ? (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default">{lastRunChip}</span>
            </TooltipTrigger>
            <TooltipContent>{lastRun.tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        lastRunChip
      )}
    </div>
  );
}
