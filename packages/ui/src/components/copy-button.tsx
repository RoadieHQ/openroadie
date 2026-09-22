import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';
import { cn } from '../lib/utils';

/**
 * Copy-to-clipboard state: `copy(value)` writes to the clipboard and flips
 * `copied` for `timeoutMs`. Best-effort — clipboard failures reset `copied`
 * and surface nothing. The reset timer is cleared on re-copy and unmount.
 */
export function useCopyToClipboard(timeoutMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), timeoutMs);
      } catch {
        setCopied(false);
      }
    },
    [timeoutMs],
  );

  return { copied, copy };
}

export interface CopyButtonProps {
  /** Text to copy — pass a getter when building it is expensive. */
  value: string | (() => string);
  label?: string;
  copiedLabel?: string;
  className?: string;
}

/**
 * Ghost icon button that copies `value` to the clipboard, swapping the copy
 * icon for a success check for two seconds. Tooltip shows `label`/`copiedLabel`.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied!',
  className,
}: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = (event: MouseEvent) => {
    event.stopPropagation();
    void copy(typeof value === 'function' ? value() : value);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            aria-label={copied ? copiedLabel : label}
            className={cn(
              'size-6',
              copied
                ? 'text-success hover:text-success'
                : 'text-muted-foreground hover:text-foreground',
              className,
            )}
          >
            {copied ? (
              <Check className="size-3" aria-hidden="true" />
            ) : (
              <Copy className="size-3" aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? copiedLabel : label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
