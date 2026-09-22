import * as React from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Modal side panel that slides in from the left or right edge (built on
 * Radix Dialog). Use it for supplementary detail/edit surfaces that overlay
 * the page; use Dialog for centered prompts, and Drawer (or the
 * resizable-drawer parts) for bottom panels.
 */
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetPortal = SheetPrimitive.Portal;
const SheetClose = SheetPrimitive.Close;

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      'motion-radix-overlay fixed inset-0 z-overlay bg-overlay',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  'motion-sheet-content fixed inset-y-0 z-overlay flex h-full flex-col gap-0 border-divider bg-surface text-surface-foreground shadow-md [--field-bg:var(--color-surface)] focus:outline-none',
  {
    variants: {
      side: {
        right: 'right-0 border-l',
        left: 'left-0 border-r',
      },
      size: {
        sm: 'w-full sm:w-[var(--sheet-width-sm)] sm:max-w-[92vw]',
        md: 'w-full sm:w-[var(--sheet-width-md)] sm:max-w-[92vw]',
        lg: 'w-full sm:w-[var(--sheet-width-lg)] sm:max-w-[92vw]',
        xl: 'w-full sm:w-[var(--sheet-width-xl)] sm:max-w-[92vw]',
      },
    },
    defaultVariants: {
      side: 'right',
      size: 'md',
    },
  },
);

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  hideCloseButton?: boolean;
  /** Omit the dimming scrim. This removes only the visual overlay — to leave the
   * page interactive behind the sheet, also set `modal={false}` on `Sheet`
   * (Radix otherwise keeps a focus trap and `pointer-events:none` on the rest of
   * the page). */
  hideOverlay?: boolean;
}

/**
 * Sheet panel. Compose SheetHeader / SheetBody (the scrollable region) /
 * SheetFooter inside it; `size` maps to the `--sheet-width-*` tokens.
 * Declares `--field-bg` so outlined (floating-label) fields inside notch
 * their labels correctly.
 */
const SheetContent = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(
  (
    { className, children, side, size, hideCloseButton, hideOverlay, ...props },
    ref,
  ) => (
    <SheetPortal>
      {!hideOverlay && <SheetOverlay />}
      <SheetPrimitive.Content
        ref={ref}
        data-side={side ?? 'right'}
        className={cn(sheetVariants({ side, size }), className)}
        {...props}
      >
        {children}
        {!hideCloseButton && (
          <SheetPrimitive.Close className="motion-opacity absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-1.5 border-b border-divider p-6',
        className,
      )}
      {...props}
    />
  );
}

function SheetBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex-1 overflow-y-auto p-6', className)} {...props} />
  );
}

function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 border-t border-divider p-6 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg leading-none font-semibold tracking-tight',
      className,
    )}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  sheetVariants,
};
