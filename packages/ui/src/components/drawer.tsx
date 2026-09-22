import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { cn } from '../lib/utils';

/**
 * Bottom sheet that slides up from the bottom edge (vaul), with drag-to-dismiss.
 * For side panels use Sheet; for centered modals use Dialog.
 */
function Drawer({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      shouldScaleBackground={shouldScaleBackground}
      {...props}
    />
  );
}

const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerPortal = DrawerPrimitive.Portal;
const DrawerClose = DrawerPrimitive.Close;
const DrawerHandle = DrawerPrimitive.Handle;

const DrawerOverlay = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-overlay bg-overlay', className)}
    {...props}
  />
));
DrawerOverlay.displayName = 'DrawerOverlay';

type DrawerContentProps = React.ComponentPropsWithoutRef<
  typeof DrawerPrimitive.Content
> & {
  /**
   * Optional container for the drawer's portal. When provided the overlay
   * and content are rendered inside this element instead of document.body
   * — useful for scoping the drawer to a region of the page (e.g. a canvas).
   * Pair with `scope="container"` to switch positioning from `fixed` to
   * `absolute` so the overlay stays within the container's bounds.
   */
  container?: HTMLElement | null;
  /**
   * `'viewport'` (default) keeps the original `fixed`-positioned overlay,
   * top margin, and built-in drag handle bar. `'container'` switches
   * positioning to `absolute` and drops the bottom-sheet idioms (top
   * margin, default handle) so the caller can lay out the drawer freely
   * inside its parent.
   */
  scope?: 'viewport' | 'container';
  overlayClassName?: string;
  /**
   * Set to true to skip rendering the dimming overlay. Pair with the
   * Drawer Root's `modal={false}` so areas outside the drawer remain
   * interactive (e.g. an in-canvas drawer that should not block the
   * toolbar).
   */
  hideOverlay?: boolean;
};

/**
 * The sliding drawer panel plus its overlay. Defaults to a viewport-wide
 * bottom sheet with a drag handle; see `container`/`scope`/`hideOverlay` for
 * scoping it to a region of the page instead.
 */
const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Content>,
  DrawerContentProps
>(
  (
    {
      className,
      children,
      container,
      scope = 'viewport',
      overlayClassName,
      hideOverlay = false,
      ...props
    },
    ref,
  ) => (
    <DrawerPortal container={container ?? undefined}>
      {!hideOverlay && (
        <DrawerPrimitive.Overlay
          className={cn(
            scope === 'container' ? 'absolute' : 'fixed',
            'inset-0 z-overlay bg-overlay',
            overlayClassName,
          )}
        />
      )}
      <DrawerPrimitive.Content
        ref={ref}
        className={cn(
          scope === 'container' ? 'absolute' : 'fixed',
          'inset-x-0 bottom-0 z-overlay flex flex-col rounded-t-lg border bg-background',
          scope === 'viewport' && 'mt-24',
          className,
        )}
        {...props}
      >
        {scope === 'viewport' && (
          <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
        )}
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  ),
);
DrawerContent.displayName = 'DrawerContent';

function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('grid gap-1.5 p-6 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-auto flex flex-col gap-2 p-6', className)}
      {...props}
    />
  );
}

const DrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg leading-none font-semibold tracking-tight',
      className,
    )}
    {...props}
  />
));
DrawerTitle.displayName = 'DrawerTitle';

const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DrawerDescription.displayName = 'DrawerDescription';

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
