import type { ReactNode } from 'react';
import { ExternalLink, Pencil, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@roadiehq/ui/sheet';
import { Button } from '@roadiehq/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@roadiehq/ui/alert';
import { cn } from '@roadiehq/ui/utils';
import { useDelayedFlag } from '../use-delayed-flag';
import { NavigationIntentLink } from '../navigation-intent-link';
import { DetailDrawerSkeleton } from './detail-drawer-skeleton';

export type DetailDrawerEditAction =
  | { type: 'link'; href: string; viewTransition?: boolean }
  | { type: 'callback'; onSelect: () => void };

interface DetailDrawerBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entity name — the drawer's accessible title. */
  title: ReactNode;
  /** Optional line under the title (slug, type, etc.). Doubles as the
   * accessible description; a hidden fallback is used when omitted. */
  subtitle?: ReactNode;
  /** A status badge or similar, shown beside the title. */
  status?: ReactNode;
  /** Leading icon/logo shown before the title. */
  icon?: ReactNode;
  /** Standard editor action, either routed or handled in place. */
  editAction?: DetailDrawerEditAction;
  editLabel?: string;
  /** Extra header controls placed before the edit action (and the close
   *  button), e.g. a secondary "open in …" link. Keeps related actions grouped
   *  in the header cluster rather than split into the footer. */
  secondaryActions?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  /** Extra footer controls, placed before the built-in "Open editor" button. */
  footer?: ReactNode;
  children?: ReactNode;
  side?: 'right' | 'left';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Override the default body skeleton shown while `loading`. */
  loadingView?: ReactNode;
  /** Modal drawers dim + lock the page behind a scrim. The default is
   * non-modal: no scrim, the drawer floats over the page while the page stays
   * fully interactive (the layout is not reflowed), and clicking another row
   * swaps the drawer's contents instead of closing it. */
  modal?: boolean;
  /** Non-modal only: an outside click whose target matches this selector keeps
   * the drawer open (it will swap contents) rather than closing it. Defaults to
   * overview-table rows; clicking anywhere else closes the drawer. */
  keepOpenSelector?: string;
}

export type DetailDrawerProps = DetailDrawerBaseProps;

/**
 * Reusable "Notion-style" detail drawer for overview-table rows. A right-side
 * sheet with a pinned header (title + status + close), a scrollable body, and a
 * footer whose primary action opens the full editor. Read first; edit is an
 * explicit escape hatch. Non-modal by default: the drawer floats over the page,
 * which stays visible and interactive, without reflowing the layout.
 */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  status,
  icon,
  editAction,
  editLabel = 'Open editor',
  secondaryActions,
  loading = false,
  error,
  footer,
  children,
  side = 'right',
  size = 'md',
  loadingView,
  modal = false,
  keepOpenSelector = '[data-row-id]',
}: DetailDrawerProps) {
  const showSkeleton = useDelayedFlag(loading);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={modal}>
      <SheetContent
        side={side}
        size={size}
        className="gap-0"
        hideOverlay={!modal}
        // We render our own close in the header action cluster so the edit
        // action and close sit together (Notion/Linear-style), keeping actions
        // out of a heavy footer.
        hideCloseButton
        // Non-modal dismissal: clicking another row swaps the drawer's contents
        // (the row's own handler updates the selection), so suppress Radix's
        // auto-close for those; clicking empty space, the header, or nav closes.
        onInteractOutside={
          modal
            ? undefined
            : event => {
                const target = event.detail.originalEvent.target;
                if (
                  target instanceof Element &&
                  target.closest(keepOpenSelector)
                ) {
                  event.preventDefault();
                }
              }
        }
      >
        <SheetHeader className="flex-row items-start gap-3 p-5">
          {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className="truncate">{title}</SheetTitle>
              {status}
            </div>
            {/* Always render one Description so Radix wires aria-describedby;
                falls back to a screen-reader-only label when none is given. */}
            <SheetDescription
              className={cn(
                'min-w-0',
                !subtitle && 'sr-only',
                typeof subtitle === 'string' && 'truncate',
              )}
            >
              {subtitle ?? 'Details'}
            </SheetDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {secondaryActions}
            {editAction?.type === 'link' ? (
              <Button asChild variant="outline" size="sm">
                <NavigationIntentLink
                  to={editAction.href}
                  viewTransition={editAction.viewTransition}
                >
                  <ExternalLink className="size-4" />
                  {editLabel}
                </NavigationIntentLink>
              </Button>
            ) : editAction?.type === 'callback' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={editAction.onSelect}
              >
                <Pencil className="size-4" />
                {editLabel}
              </Button>
            ) : null}
            <SheetClose className="motion-colors inline-flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-5 p-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn't load details</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : showSkeleton ? (
            (loadingView ?? <DetailDrawerSkeleton />)
          ) : loading ? null : (
            children
          )}
        </SheetBody>

        {footer && <SheetFooter className="p-5">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}
