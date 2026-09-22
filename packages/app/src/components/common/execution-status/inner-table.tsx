import React from 'react';

export const INNER_TABLE_WRAPPER =
  'overflow-hidden rounded-md border border-border';
/**
 * Header cell for the compact inner-panel tables. Harmonized with the Data
 * Sources listing header treatment (`text-sm font-medium text-foreground/80`,
 * `h-10`) so every table header in the app reads as one design language, while
 * keeping the inner tables' tighter `px-3` horizontal rhythm.
 */
export const INNER_TABLE_HEAD_CELL =
  'h-10 px-3 py-1 text-sm font-medium text-foreground/80';
export const INNER_TABLE_BODY_CELL = 'px-3 py-1 text-sm';

export function InnerTableEmptyState({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="p-6 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
