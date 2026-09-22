import React from 'react';
import { Skeleton } from '../skeleton';

export function ItemListRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-md border border-border bg-card p-3">
      <Skeleton className="size-10 rounded-md" />
      <div className="min-w-0 flex-1">
        <Skeleton className="mb-1 h-4 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}
