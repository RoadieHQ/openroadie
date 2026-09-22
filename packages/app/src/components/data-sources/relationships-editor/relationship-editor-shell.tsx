import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import {
  DrawerPanelHeader,
  DrawerResizeHandle,
  useResizableDrawerPanel,
} from '@roadiehq/ui/resizable-drawer';

/**
 * One endpoint of the edge shown in the header: a labelled, logo'd chip that
 * optionally links somewhere (a rule links to its data source; a manual edge to
 * the object). Without an `href` it renders as plain text (e.g. a target that
 * hasn't been picked yet).
 */
export interface EditorEndpoint {
  label: string;
  logoUrl?: string;
  /** Opens in a new tab when set. */
  href?: string;
}

export interface RelationshipEditorShellProps {
  variant?: 'drawer' | 'page';
  open: boolean;
  /** Portal target for the drawer variant. Ignored by the page variant. */
  container?: HTMLElement | null;
  title: string;
  source: EditorEndpoint;
  target: EditorEndpoint;
  /** Editor-specific action cluster (save / cancel / delete / approve …). */
  actions: ReactNode;
  /** Escape closes the editor. */
  onClose: () => void;
  /** Primary action for Cmd/Ctrl+Enter; the caller decides what it does. */
  onSubmit?: () => void;
  /** Gates the Cmd/Ctrl+Enter shortcut. */
  canSubmit?: boolean;
  /** While busy, keyboard shortcuts are ignored. */
  busy?: boolean;
  /** Hide the drawer header (the page variant renders its own chrome). */
  showHeader?: boolean;
  /** "Pop out to full page" link shown in the drawer header. */
  standaloneHref?: string;
  standaloneTitle?: string;
  /** Noun used in the drawer's resize/expand affordance labels. */
  drawerLabel?: string;
  /** Re-arm the drawer's default height when this key changes. */
  drawerResetKey?: string | number | null;
  children: ReactNode;
}

function EndpointChip({ endpoint }: { endpoint: EditorEndpoint }) {
  const inner = (
    <>
      <IntegrationIconFrame size="group">
        <IntegrationLogo src={endpoint.logoUrl ?? ''} size={16} />
      </IntegrationIconFrame>
      <span className="truncate font-semibold text-foreground group-hover/endpoint:text-primary group-hover/endpoint:underline">
        {endpoint.label}
      </span>
      {endpoint.href && (
        <ExternalLink
          className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/endpoint:opacity-100"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (!endpoint.href) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <IntegrationIconFrame size="group">
          <IntegrationLogo src={endpoint.logoUrl ?? ''} size={16} />
        </IntegrationIconFrame>
        <span className="truncate font-semibold text-foreground">
          {endpoint.label}
        </span>
      </span>
    );
  }

  return (
    <Link
      to={endpoint.href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${endpoint.label} in a new tab`}
      className="motion-colors group/endpoint flex min-w-0 items-center gap-1.5 rounded hover:text-primary"
    >
      {inner}
    </Link>
  );
}

/**
 * The generic two-endpoint editor chrome shared by the relationship-rule editor
 * and the manual single-edge editor: a resizable non-modal drawer (portalled
 * into `container`) or a full-page body, a header showing `source → target` with
 * an editor-specific action cluster, and the body as `children`. It owns only
 * the chrome + the Escape / Cmd+Enter shortcuts — all edge/rule state lives in
 * the caller's editor hook.
 */
export function RelationshipEditorShell({
  variant = 'drawer',
  open,
  container,
  title,
  source,
  target,
  actions,
  onClose,
  onSubmit,
  canSubmit = false,
  busy = false,
  showHeader = true,
  standaloneHref,
  standaloneTitle = '',
  drawerLabel = 'editor drawer',
  drawerResetKey,
  children,
}: RelationshipEditorShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const { panelHeight, isCollapsed, cyclePanelHeight, resizeHandleProps } =
    useResizableDrawerPanel({
      open,
      container: container ?? null,
      initialHeight: 'mid',
      resetHeightKey: drawerResetKey,
    });

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || busy) {
        return;
      }
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        if (onSubmit && canSubmit) {
          e.preventDefault();
          onSubmit();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, canSubmit, onClose, onSubmit]);

  if (!open || (variant === 'drawer' && !container)) {
    return null;
  }

  const expanded = variant === 'page' || !isCollapsed;

  const endpoints = (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <EndpointChip endpoint={source} />
      <ArrowRight
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <EndpointChip endpoint={target} />
    </div>
  );

  const panel = (
    <div
      className={cn(
        'flex min-h-0 flex-col bg-background',
        variant === 'drawer'
          ? 'absolute right-4 bottom-0 left-4 z-overlay rounded-t-lg border border-border shadow-lg lg:right-[100px] lg:left-[100px]'
          : 'h-full',
      )}
      style={variant === 'drawer' ? { height: panelHeight } : undefined}
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      {variant === 'drawer' && (
        <DrawerResizeHandle
          isCollapsed={isCollapsed}
          label={drawerLabel}
          props={resizeHandleProps}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {!showHeader && (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        )}
        <p id={descriptionId} className="sr-only">
          Non-modal relationship editor. The page behind it remains available
          while this panel is open.
        </p>
        {showHeader && (
          <DrawerPanelHeader
            title={title}
            titleId={titleId}
            center={endpoints}
            expanded={expanded}
            onToggleExpanded={cyclePanelHeight}
            toggleDisabled={variant === 'page'}
            collapsedTitle={`Expand ${drawerLabel}`}
            expandedTitle={`Collapse ${drawerLabel}`}
            standaloneHref={variant === 'drawer' ? standaloneHref : undefined}
            standaloneTitle={standaloneTitle}
            actions={actions}
          />
        )}

        {expanded && (
          <div className="flex min-h-0 flex-1 scrollbar-thin flex-col overflow-auto p-3">
            {children}
          </div>
        )}
      </div>
    </div>
  );

  return variant === 'page' ? panel : createPortal(panel, container!);
}
