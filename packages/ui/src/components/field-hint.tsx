import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Button } from './button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';
import { cn } from '../lib/utils';

const fieldHintTriggerVariants = cva(
  'shrink-0 rounded-full p-0 text-muted-foreground/80 hover:text-foreground',
  {
    variants: {
      size: {
        sm: 'size-4 hover:bg-transparent [&_svg]:size-3.5',
        md: 'size-5 [&_svg]:size-3.5',
      },
      /**
       * Paint the trigger with `--field-bg` so it can overlap a field's border
       * without the line showing through, the way a floating label does.
       */
      onField: {
        true: 'bg-[var(--field-bg,var(--color-card))] hover:bg-[var(--field-bg,var(--color-card))]',
        false: '',
      },
    },
    defaultVariants: {
      size: 'sm',
      onField: false,
    },
  },
);

export interface FieldHintProps extends VariantProps<
  typeof fieldHintTriggerVariants
> {
  children: ReactNode;
  /** Accessible name for the trigger; say what the hint is about. */
  ariaLabel?: string;
  className?: string;
  /** Override the tooltip width; defaults to `max-w-[280px]`. */
  contentClassName?: string;
}

/**
 * A mini help affordance: a circled-question-mark button that reveals
 * explanatory text on hover/focus. Use it beside a field label instead of a
 * full helper-text paragraph, to keep dense forms compact while leaving the
 * guidance one hover away.
 */
export function FieldHint({
  children,
  ariaLabel = 'More information',
  className,
  contentClassName,
  size,
  onField,
}: FieldHintProps) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={ariaLabel}
            className={cn(
              fieldHintTriggerVariants({ size, onField }),
              className,
            )}
          >
            <CircleHelp />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          variant="rich"
          className={cn('max-w-[280px]', contentClassName)}
        >
          <div className="space-y-2 text-xs leading-5">{children}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
