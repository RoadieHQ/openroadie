import type { ReactElement } from 'react';
import { Button } from '../button';

export interface DrawerBreadcrumbCrumb {
  id: string;
  label: string;
  countLabel?: string;
}

export interface DrawerBreadcrumbProps {
  /** The path, root → active. The last entry is the current view. */
  views: DrawerBreadcrumbCrumb[];
  onNavigate: (viewId: string) => void;
}

/**
 * The drawer's view path. Ancestors are buttons that navigate back; the active
 * view is plain text marked `aria-current` — it goes nowhere, so it must not
 * look or behave like a control.
 */
export function DrawerBreadcrumb({
  views,
  onNavigate,
}: DrawerBreadcrumbProps): ReactElement {
  return (
    <nav aria-label="Drawer" className="flex min-w-0 items-center gap-1">
      {views.map((crumb, index) => {
        const isActive = index === views.length - 1;
        return (
          <span key={crumb.id} className="flex min-w-0 items-center gap-1">
            {index > 0 && (
              <span aria-hidden className="text-muted-foreground">
                /
              </span>
            )}
            {isActive ? (
              <span
                aria-current="page"
                className="truncate text-sm font-semibold text-foreground"
              >
                {crumb.label}
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="motion-colors h-auto min-w-0 rounded p-0 text-sm font-semibold text-muted-foreground hover:bg-transparent hover:text-primary"
                onClick={() => onNavigate(crumb.id)}
              >
                <span className="truncate">{crumb.label}</span>
              </Button>
            )}
            {isActive && crumb.countLabel && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {crumb.countLabel}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
