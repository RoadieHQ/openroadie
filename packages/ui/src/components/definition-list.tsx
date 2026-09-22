import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Label/value pairs for detail views (a semantic `<dl>`). `DefinitionItem`s
 * render their `<dt>`/`<dd>` as direct grid children of `DefinitionList`, so
 * every label column lines up regardless of value height.
 */
const DefinitionList = React.forwardRef<
  HTMLDListElement,
  React.HTMLAttributes<HTMLDListElement>
>(({ className, ...props }, ref) => (
  <dl
    ref={ref}
    className={cn(
      'grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-3 text-sm',
      className,
    )}
    {...props}
  />
));
DefinitionList.displayName = 'DefinitionList';

interface DefinitionItemProps {
  label: React.ReactNode;
  /** Value; empty (`null`/`undefined`/`''`) renders an em dash. */
  children?: React.ReactNode;
  className?: string;
}

function isEmptyValue(value: React.ReactNode): boolean {
  return value == null || value === '';
}

/**
 * The value half of a label/value pair: renders `children`, or an em dash when
 * it is empty (`null`/`undefined`/`''`). Adds no wrapper element, so any
 * label/value layout can share the fallback — `DefinitionItem` here and the
 * app's `DetailFields` both do.
 */
function DefinitionValue({ children }: { children?: React.ReactNode }) {
  return isEmptyValue(children) ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <>{children}</>
  );
}

/** One label/value row of a DefinitionList; must be a direct child of it. */
function DefinitionItem({ label, children, className }: DefinitionItemProps) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn('min-w-0 break-words text-surface-foreground', className)}
      >
        <DefinitionValue>{children}</DefinitionValue>
      </dd>
    </>
  );
}

export { DefinitionList, DefinitionItem, DefinitionValue };
