import * as React from 'react';
import { cn } from '@roadiehq/ui/utils';

/** Standalone route body: gutters + rhythm for full-page listings (data sources, integrations, etc.). */
export function OverviewListingStandaloneBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'w-full min-w-0 flex-1 space-y-6 px-4 py-4 sm:px-6',
        className,
      )}
      {...props}
    />
  );
}

/** Embedded in admin tabs or other shells that already add horizontal padding elsewhere. */
export function OverviewListingEmbeddedBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('flex w-full min-w-0 flex-1 flex-col space-y-6', className)}
      {...props}
    />
  );
}
