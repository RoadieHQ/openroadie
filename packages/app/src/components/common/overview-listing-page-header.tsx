import * as React from 'react';

export interface OverviewListingPageHeaderProps {
  title: string;
  description: string;
  /** Search / filters shown before `primaryAction` on the same row (saves vertical space). */
  toolbar?: React.ReactNode;
  /** e.g. primary toolbar button (New); omit for pages without a create action. */
  primaryAction?: React.ReactNode;
}

export function OverviewListingPageHeader({
  title,
  description,
  toolbar,
  primaryAction,
}: OverviewListingPageHeaderProps) {
  const hasActionsRow = toolbar != null || primaryAction != null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-4">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm whitespace-nowrap text-muted-foreground">
          {description}
        </p>
      </div>
      {hasActionsRow ? (
        <div className="flex w-full min-w-[min(100%,max-content)] flex-1 flex-wrap items-center justify-end gap-2 md:gap-3">
          {toolbar}
          {primaryAction}
        </div>
      ) : null}
    </div>
  );
}
