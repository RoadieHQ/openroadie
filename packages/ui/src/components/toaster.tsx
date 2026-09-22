import React from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

export type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * App-wide toast outlet (sonner) — mount once near the root. Fire
 * notifications from anywhere with the re-exported `toast` function
 * (`toast.success(...)`, `toast.error(...)`).
 */
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme="system"
      position="bottom-right"
      richColors
      closeButton
      {...props}
    />
  );
}

export { toast };
