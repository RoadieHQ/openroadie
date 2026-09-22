import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';

export interface ObjectGraphCrumb {
  key: string;
  label: string;
}

/**
 * The refocus trail of the object view: earlier focuses are clickable and
 * truncate the trail back to themselves; the current focus is the terminal,
 * non-interactive crumb.
 */
export function ObjectGraphBreadcrumbs({
  trail,
  currentLabel,
  onNavigate,
}: {
  trail: ObjectGraphCrumb[];
  currentLabel: string;
  onNavigate: (index: number) => void;
}) {
  if (trail.length === 0) {
    return null;
  }
  return (
    <nav
      aria-label="Focus history"
      className="flex min-w-0 items-center gap-0.5 rounded-lg border border-border bg-card/90 px-2 py-1 text-xs shadow-sm backdrop-blur-[2px]"
    >
      {trail.map((crumb, index) => (
        <Fragment key={`${crumb.key}-${index}`}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 max-w-36 truncate px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
            onClick={() => onNavigate(index)}
            title={`Back to ${crumb.label}`}
          >
            <span className="truncate">{crumb.label}</span>
          </Button>
          <ChevronRight
            className="size-3 shrink-0 text-muted-foreground/60"
            aria-hidden
          />
        </Fragment>
      ))}
      <span className="max-w-40 truncate px-1 font-medium text-foreground">
        {currentLabel}
      </span>
    </nav>
  );
}
