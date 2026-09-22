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

import React from 'react';
import { Link } from 'react-router';
import { Trash2, Play, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '../tooltip';
import { IntegrationIconFrame } from './integration-icon-frame';
import { IntegrationLogo } from './integration-logo';
import type { BaseItem } from './types';

interface ItemListRowProps<T extends BaseItem> {
  item: T;
  /** Link target covering the whole row; takes precedence over `onEdit` as the row's click behavior. */
  to?: string;
  /** Without `to`, makes the row itself clickable (and keyboard-activatable) to edit the item. */
  onEdit?: (id: string) => void;
  onDelete?: (id: string, name: string) => void;
  onRun?: (id: string) => Promise<void>;
  /** Ids currently executing — their Run button shows a spinner and is disabled. */
  runningIds?: Set<string>;
  showEnabledStatus?: boolean;
  /** Extra always-visible metadata rendered before the actions (e.g. badges, timestamps). */
  renderMeta?: (item: T) => React.ReactNode;
  /** Replaces the default hover-revealed run/delete actions entirely. */
  renderActions?: (item: T) => React.ReactNode;
}

/**
 * Card-style row for item listings (used inside ItemsGrid): logo, name and
 * description, an enabled-status dot, and run/delete actions revealed on
 * hover. The whole row navigates via `to`, or falls back to `onEdit` as a
 * click handler.
 */
export function ItemListRow<T extends BaseItem>({
  item,
  to,
  onEdit,
  onDelete,
  onRun,
  runningIds,
  showEnabledStatus = true,
  renderMeta,
  renderActions,
}: ItemListRowProps<T>) {
  const isEnabled = item.enabled ?? true;
  const isClickable = !to && !!onEdit;
  const handleEdit = () => onEdit?.(item.id);
  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isClickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleEdit();
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        onClick={isClickable ? handleEdit : undefined}
        onKeyDown={isClickable ? handleRowKeyDown : undefined}
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        className={cn(
          'group motion-all-standard relative flex items-center gap-4 rounded-md border border-border bg-card p-3 hover:border-border/80',
          isClickable && 'cursor-pointer',
        )}
      >
        {to && (
          <Link
            to={to}
            aria-label={item.name}
            className="absolute inset-0 z-base"
          />
        )}

        <IntegrationIconFrame size="row">
          <IntegrationLogo src={item.logoUrl} size={24} />
        </IntegrationIconFrame>

        <div className="min-w-0 flex-1">
          <span className="truncate text-base font-semibold text-foreground">
            {item.name}
          </span>
          {item.description && (
            <p className="truncate text-xs text-muted-foreground">
              {item.description}
            </p>
          )}
        </div>

        {showEnabledStatus && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                'size-1.5 rounded-full',
                isEnabled ? 'bg-success' : 'bg-muted-foreground',
              )}
            />
            <span
              className={cn(
                'text-2xs font-medium',
                isEnabled ? 'text-success' : 'text-muted-foreground',
              )}
            >
              {isEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        )}

        {renderMeta && (
          <div className="relative z-raised shrink-0">{renderMeta(item)}</div>
        )}

        {renderActions ? (
          // Passive wrapper: the only handler is `stopPropagation`, which
          // prevents action clicks from bubbling up and triggering the row's
          // `handleEdit`. It does not introduce new interactivity, so the
          // a11y rules for static-element-interactions do not apply.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- passive click sink, see comment above
          <div
            className="relative z-raised flex shrink-0 items-center"
            onClick={e => e.stopPropagation()}
          >
            {renderActions(item)}
          </div>
        ) : onRun || onDelete ? (
          <div className="motion-opacity pointer-events-none absolute inset-y-0 right-3 z-raised flex items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100">
            {onRun && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    // Per item: these repeat once per row.
                    aria-label={`Run ${item.name}`}
                    disabled={!isEnabled || runningIds?.has(item.id)}
                    onClick={e => {
                      e.stopPropagation();
                      onRun(item.id);
                    }}
                    className="motion-colors inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-success disabled:opacity-50"
                  >
                    {runningIds?.has(item.id) ? (
                      <Loader2 className="motion-icon-spin size-4" />
                    ) : (
                      <Play className="size-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {isEnabled ? 'Run' : 'Enable to run'}
                </TooltipContent>
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Delete ${item.name}`}
                    onClick={e => {
                      e.stopPropagation();
                      onDelete(item.id, item.name);
                    }}
                    className="motion-colors inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            )}
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
