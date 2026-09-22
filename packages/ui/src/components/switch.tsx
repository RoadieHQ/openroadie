import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

/**
 * On/off toggle (Radix Switch) for settings that take effect immediately —
 * use Checkbox for selections submitted with a form. Controlled via
 * `checked` / `onCheckedChange`.
 */
const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      'group peer motion-colors relative inline-flex h-6 w-10 shrink-0 items-center pl-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
    ref={ref}
  >
    <span className="motion-colors pointer-events-none absolute inset-x-[7px] h-2.5 rounded-full group-data-[state=checked]:bg-success/50 group-data-[state=unchecked]:bg-muted-foreground/30" />
    <SwitchPrimitive.Thumb
      className={cn(
        'motion-transform pointer-events-none relative z-float block size-4 rounded-full shadow-md ring-0 data-[state=checked]:translate-x-4 data-[state=checked]:bg-success data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-muted-foreground/40',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
