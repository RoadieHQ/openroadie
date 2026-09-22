import { Check, Copy } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { useCopyToClipboard } from '@roadiehq/ui/copy-button';
import { cn } from '@roadiehq/ui/utils';

export function ObjectIdChip({
  objectId,
  className,
  iconOnly = false,
}: {
  objectId: string;
  /** Callers in tight rows cap the width; the id truncates, copy is unaffected. */
  className?: string;
  /**
   * Drop the printed id, keep the copy control. For surfaces already showing
   * the id — an object with no presentation title is titled by its id — where
   * spelling it out again would print the same string twice. The button still
   * copies: the text is the redundant part, not the affordance.
   */
  iconOnly?: boolean;
}) {
  const { copied, copy } = useCopyToClipboard();
  const handleCopy = () => void copy(objectId);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      title={iconOnly ? `Copy object id: ${objectId}` : 'Copy object id'}
      aria-label="Copy object id"
      className={cn(
        'h-auto max-w-full rounded-md border border-dashed border-border bg-transparent py-1 font-mono text-2xs font-normal text-muted-foreground shadow-none hover:border-primary/60 hover:bg-transparent hover:text-foreground',
        iconOnly ? 'px-1.5' : 'px-2',
        className,
      )}
    >
      {iconOnly ? null : (
        <>
          <span className="font-sans font-medium text-muted-foreground/70">
            ID
          </span>
          <span className="min-w-0 truncate">{objectId}</span>
        </>
      )}
      {copied ? (
        <Check className="size-3 shrink-0 text-success" />
      ) : (
        <Copy className="size-3 shrink-0" />
      )}
      {copied && <span className="font-sans">Copied</span>}
    </Button>
  );
}
