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
import { Plus } from 'lucide-react';
import { Button } from '../button';
import { motion } from 'motion/react';
import { IntegrationIconFrame } from './integration-icon-frame';
import { IntegrationLogo } from './integration-logo';
import { ItemListRowSkeleton } from './item-list-row-skeleton';
import { cardContainerVariants, cardItemVariants } from './constants';
import type { BaseItem, ItemGroup } from './types';

interface ItemsGridProps<T extends BaseItem> {
  items: T[];
  /** When provided, rows render under per-group headers (logo, label, count) instead of one flat list. */
  groups?: ItemGroup<T>[];
  /** Shows skeleton rows only while there are no items yet (first load); refetches keep the current rows. */
  loading?: boolean;
  onCreate: () => void;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  createButtonLabel: string;
  renderListRow: (item: T) => React.ReactNode;
}

function GroupHeader({ group }: { group: ItemGroup<BaseItem> }) {
  return (
    <div className="mb-3 flex items-center gap-2 px-1">
      <IntegrationIconFrame size="group">
        <IntegrationLogo src={group.logoUrl} size={16} />
      </IntegrationIconFrame>
      <span className="text-base font-semibold text-foreground">
        {group.label}
      </span>
      <span className="text-xs text-muted-foreground">
        ({group.items.length})
      </span>
    </div>
  );
}

/**
 * Animated list body for item listing pages: skeleton rows on first load, a
 * centered empty state with a create CTA when there are no items, otherwise
 * staggered-entrance rows (optionally grouped) rendered via `renderListRow`
 * — typically an ItemListRow.
 */
export function ItemsGrid<T extends BaseItem>(props: ItemsGridProps<T>) {
  const {
    items,
    groups,
    loading,
    onCreate,
    emptyIcon,
    emptyTitle,
    emptyDescription,
    createButtonLabel,
    renderListRow,
  } = props;

  if (loading && items.length === 0) {
    return (
      <motion.div
        variants={cardContainerVariants}
        initial="hidden"
        animate="show"
      >
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 5 }, (_, i) => (
            <motion.div key={i} variants={cardItemVariants}>
              <ItemListRowSkeleton />
            </motion.div>
          ))}
        </div>
      </motion.div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-accent">
          {emptyIcon}
        </div>
        <h3 className="mb-2 text-base font-semibold text-muted-foreground">
          {emptyTitle}
        </h3>
        <p className="mb-8 max-w-[400px] text-sm text-muted-foreground">
          {emptyDescription}
        </p>
        <Button size="lg" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          {createButtonLabel}
        </Button>
      </div>
    );
  }

  const animationKey = items.map(i => i.id).join(',');

  if (groups && groups.length > 0) {
    return (
      <motion.div
        variants={cardContainerVariants}
        initial="hidden"
        animate="show"
        key={animationKey}
      >
        <div className="flex flex-col gap-6">
          {groups.map(group => (
            <div key={group.key}>
              <GroupHeader group={group} />
              <div className="flex flex-col gap-1.5">
                {group.items.map(item => (
                  <motion.div key={item.id} variants={cardItemVariants}>
                    {renderListRow(item)}
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={cardContainerVariants}
      initial="hidden"
      animate="show"
      key={animationKey}
    >
      <div className="flex flex-col gap-1.5">
        {items.map(item => (
          <motion.div key={item.id} variants={cardItemVariants}>
            {renderListRow(item)}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
