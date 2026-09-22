import * as React from 'react';
import { Slot as SlotPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background motion-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 data-[loading=true]:[&_svg]:motion-pulse',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        sidebar:
          'w-full justify-start gap-0 border-0 bg-transparent p-0 font-normal shadow-none [&_svg]:size-[18px]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a link) with button styling instead of a `<button>`. */
  asChild?: boolean;
  /** Disables the button and pulses its icon; combine with `loadingText`. */
  loading?: boolean;
  /** Text swapped in while `loading`; the button keeps the wider of the two widths so it never resizes. */
  loadingText?: string;
}

/**
 * Standard button. Variant intents: `default` for the primary action,
 * `outline`/`secondary` for secondary actions, `destructive` for dangerous
 * ones, `ghost` for low-emphasis/icon buttons, `link` for inline text actions,
 * and `sidebar` for the full-width borderless nav rows; `size="icon"` makes a
 * square icon-only button.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? SlotPrimitive.Root : 'button';
    const isDisabled = disabled || loading;
    const useGhost = !asChild && loadingText !== undefined;

    let content: React.ReactNode = children;

    if (useGhost) {
      let textReplaced = false;
      content = React.Children.map(children, child => {
        if (
          !textReplaced &&
          (typeof child === 'string' || typeof child === 'number')
        ) {
          textReplaced = true;
          return (
            <span className="grid grid-cols-1">
              <span className="col-start-1 row-start-1">
                {loading ? loadingText : child}
              </span>
              <span
                aria-hidden="true"
                className="invisible col-start-1 row-start-1"
              >
                {loading ? child : loadingText}
              </span>
            </span>
          );
        }
        return child;
      });
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        disabled={isDisabled}
        data-loading={loading || undefined}
        {...props}
      >
        {content}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
