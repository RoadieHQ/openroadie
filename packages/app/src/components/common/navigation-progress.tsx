import { LoaderCircle } from 'lucide-react';
import { useNavigation } from 'react-router';
import { useDelayedFlag } from './use-delayed-flag';

export function NavigationProgress({
  label = 'Loading page…',
}: {
  label?: string;
}) {
  const navigation = useNavigation();
  const visible = useDelayedFlag(navigation.state !== 'idle', {
    delayMs: 120,
    minVisibleMs: 250,
  });

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none sticky top-3 z-50 flex h-0 shrink-0 justify-center"
    >
      <span className="motion-action-notice flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
        <LoaderCircle className="motion-icon-spin size-3.5" />
        {label}
      </span>
    </div>
  );
}
