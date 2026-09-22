import { useState, useCallback } from 'react';
import { Badge } from '../badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../collapsible';
import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';
import { BrainIcon, ChevronDownIcon, DotIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { createContext, memo, useContext, useMemo, useEffect } from 'react';

interface ChainOfThoughtContextValue {
  isOpen: boolean;
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null,
);

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(
      'ChainOfThought components must be used within ChainOfThought',
    );
  }
  return context;
};

export type ChainOfThoughtProps = ComponentProps<'div'> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const isOpen = open ?? internalOpen;
    const setIsOpen = useCallback(
      (value: boolean) => {
        setInternalOpen(value);
        onOpenChange?.(value);
      },
      [onOpenChange],
    );
    useEffect(() => {
      if (open !== undefined) setInternalOpen(open);
    }, [open]);

    const chainOfThoughtContext = useMemo(() => ({ isOpen }), [isOpen]);

    return (
      <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
        {/* One root spans header and content so Radix generates a single content
            id — a root per part gave the trigger an aria-controls that resolved
            to nothing. */}
        <Collapsible
          className={cn('not-prose w-full space-y-4', className)}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ChainOfThoughtContext.Provider>
    );
  },
);

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
>;

export const ChainOfThoughtHeader = memo(
  ({ className, children, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen } = useChainOfThought();

    return (
      <CollapsibleTrigger
        className={cn(
          'motion-colors flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground',
          className,
        )}
        {...props}
      >
        <BrainIcon className="size-4" />
        <span className="flex-1 text-left">
          {children ?? 'Chain of Thought'}
        </span>
        <ChevronDownIcon
          className={cn(
            'motion-transform size-4',
            isOpen ? 'rotate-180' : 'rotate-0',
          )}
        />
      </CollapsibleTrigger>
    );
  },
);

export type ChainOfThoughtStepProps = ComponentProps<'div'> & {
  icon?: LucideIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: 'complete' | 'active' | 'pending';
};

const stepStatusStyles = new Map<
  NonNullable<ChainOfThoughtStepProps['status']>,
  string
>([
  ['active', 'text-foreground'],
  ['complete', 'text-muted-foreground'],
  ['pending', 'text-muted-foreground'],
]);

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon = DotIcon,
    label,
    description,
    status = 'complete',
    children,
    ...props
  }: ChainOfThoughtStepProps) => (
    <div
      className={cn(
        'flex gap-2 text-sm',
        stepStatusStyles.get(status),
        'motion-action-notice',
        className,
      )}
      {...props}
    >
      <div className="relative mt-0.5">
        <Icon className="size-4" />
        <div className="absolute top-7 bottom-0 left-1/2 -mx-px w-px bg-border" />
      </div>
      <div className="flex-1 space-y-2 overflow-hidden">
        <div>{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
        {children}
      </div>
    </div>
  ),
);

export type ChainOfThoughtSearchResultsProps = ComponentProps<'div'>;

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    />
  ),
);

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export const ChainOfThoughtSearchResult = memo(
  ({ className, children, ...props }: ChainOfThoughtSearchResultProps) => (
    <Badge
      className={cn('gap-1 px-2 py-0.5 text-xs font-normal', className)}
      variant="secondary"
      {...props}
    >
      {children}
    </Badge>
  ),
);

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const ChainOfThoughtContent = memo(
  ({ className, children, ...props }: ChainOfThoughtContentProps) => (
    <CollapsibleContent
      className={cn(
        'mt-2 space-y-3',
        'motion-vertical-disclosure text-popover-foreground outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </CollapsibleContent>
  ),
);

export type ChainOfThoughtImageProps = ComponentProps<'div'> & {
  caption?: string;
};

export const ChainOfThoughtImage = memo(
  ({ className, children, caption, ...props }: ChainOfThoughtImageProps) => (
    <div className={cn('mt-2 space-y-2', className)} {...props}>
      <div className="relative flex max-h-[22rem] items-center justify-center overflow-hidden rounded-lg bg-muted p-3">
        {children}
      </div>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
  ),
);

ChainOfThought.displayName = 'ChainOfThought';
ChainOfThoughtHeader.displayName = 'ChainOfThoughtHeader';
ChainOfThoughtStep.displayName = 'ChainOfThoughtStep';
ChainOfThoughtSearchResults.displayName = 'ChainOfThoughtSearchResults';
ChainOfThoughtSearchResult.displayName = 'ChainOfThoughtSearchResult';
ChainOfThoughtContent.displayName = 'ChainOfThoughtContent';
ChainOfThoughtImage.displayName = 'ChainOfThoughtImage';
