import type { ReactNode } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './accordion';
import { cn } from '../lib/utils';

interface AdvancedSectionProps {
  children: ReactNode;
  label?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `boxed` (default) draws a bordered card; `embedded` fits inside a parent container. */
  variant?: 'boxed' | 'embedded';
  className?: string;
  contentClassName?: string;
}

/**
 * Collapsed-by-default "Advanced" disclosure for the less-common options of a
 * form or editor. Uncontrolled via `defaultOpen`, or controlled via
 * `open`/`onOpenChange`.
 */
export function AdvancedSection({
  children,
  label = 'Advanced',
  defaultOpen = false,
  open,
  onOpenChange,
  variant = 'boxed',
  className,
  contentClassName,
}: AdvancedSectionProps) {
  const embedded = variant === 'embedded';

  return (
    <div
      className={cn(
        embedded ? undefined : 'rounded-lg border border-divider',
        className,
      )}
    >
      <Accordion
        type="single"
        collapsible
        defaultValue={
          open === undefined && defaultOpen ? 'advanced' : undefined
        }
        value={open === undefined ? undefined : open ? 'advanced' : ''}
        onValueChange={
          onOpenChange ? value => onOpenChange(value === 'advanced') : undefined
        }
        className="w-full border-none"
      >
        <AccordionItem value="advanced" className="border-none">
          <AccordionTrigger
            className={cn(
              'text-sm font-medium text-foreground outline-none hover:no-underline focus-visible:no-underline focus-visible:ring-2 focus-visible:ring-ring',
              embedded
                ? 'w-full rounded-none border-0 bg-transparent px-0 py-3 hover:bg-transparent focus-visible:ring-offset-0'
                : 'mx-1 mt-1 rounded-md bg-muted/40 px-4 py-3 hover:bg-muted/60 focus-visible:ring-inset dark:bg-muted/20 dark:hover:bg-muted/40',
            )}
          >
            {label}
          </AccordionTrigger>
          <AccordionContent
            className={cn(
              'flex flex-col gap-4 border-t border-divider pt-4',
              embedded ? 'pb-0' : 'mx-1 px-3 pb-3',
              contentClassName,
            )}
          >
            {children}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
