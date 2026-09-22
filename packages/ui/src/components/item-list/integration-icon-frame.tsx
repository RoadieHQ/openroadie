import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type IntegrationIconFrameSize = 'row' | 'compact' | 'group' | 'mini';

export interface IntegrationIconFrameProps {
  children: ReactNode;
  size?: IntegrationIconFrameSize;
  className?: string;
  well?: boolean;
}

function frameSizeClass(size: IntegrationIconFrameSize): string {
  switch (size) {
    case 'row':
      return 'size-8 rounded-md';
    case 'compact':
      return 'size-6 rounded';
    case 'group':
      return 'size-5 rounded';
    case 'mini':
      return 'size-5 rounded-sm';
  }
}

export function IntegrationIconFrame({
  children,
  size = 'row',
  className,
  well = true,
}: IntegrationIconFrameProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden',
        well
          ? 'border border-border bg-integration-icon-well [&_svg]:text-neutral-500'
          : 'border-0 bg-transparent',
        frameSizeClass(size),
        className,
      )}
    >
      {children}
    </div>
  );
}
