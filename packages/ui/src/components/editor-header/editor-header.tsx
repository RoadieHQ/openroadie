import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from '../badge';
import { Button } from '../button';
import { Skeleton } from '../skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../tooltip';
import { useEditableName } from './use-editable-name';
import { useEditorHeaderTitleRegistry } from './editor-header-title-context';

type SaveState = 'manual' | 'none';

/**
 * One ancestor level of the breadcrumb trail. `to` makes it a link; omit it for
 * a level with no route of its own. The trail never includes the current page —
 * that is the header's title.
 */
interface EditorHeaderBreadcrumb {
  label: string;
  to?: string;
  /** The label is still resolving — render a placeholder rather than a
   *  stand-in value. Use only for a genuine in-flight fetch: once it settles,
   *  a level that stays unresolved needs a real label, not a permanent bar. */
  loading?: boolean;
}

interface EditorHeaderProps {
  title: string;
  /** Optional one-line description, rendered inline after the title (and slug
   *  adornment), truncated to keep the rail at its fixed height. */
  description?: string;
  documentTitle?: string;
  icon?: React.ReactNode;
  titleAdornment?: React.ReactNode;

  editable?: boolean;
  onTitleChange?: (name: string) => void;

  /** Makes the description subtitle click-to-edit, mirroring the title.
   *  When editable and empty, shows `descriptionPlaceholder` as an affordance. */
  editableDescription?: boolean;
  onDescriptionChange?: (description: string) => void;
  descriptionPlaceholder?: string;

  backTo?: string;
  onBack?: () => void;
  /**
   * Intercepts clicks on the `backTo` link (e.g. to confirm discarding unsaved
   * changes). Call `event.preventDefault()` to stop the navigation.
   */
  onBackClick?: React.MouseEventHandler<HTMLAnchorElement>;
  /** A single ancestor, or a trail of them for pages nested more than one
   *  level deep. `breadcrumbPath` applies to the string form only. */
  breadcrumb?: string | EditorHeaderBreadcrumb[];
  breadcrumbPath?: string;

  /** 'manual' shows the Save button and the "Unsaved" badge when dirty; 'none' (default) hides the save control entirely. */
  saveState?: SaveState;
  isDirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
  saveLabel?: string;
  savingLabel?: string;
  saveDisabled?: boolean;
  /** `data-testid` for the manual-save button, so route-specific tests can target it. */
  saveButtonTestId?: string;

  /** Secondary actions rendered before the save button — NEVER the save control itself. */
  actions?: React.ReactNode;
  /** Actions rendered after the manual-save button (e.g. dry run, overflow menu). */
  trailingActions?: React.ReactNode;
  className?: string;
}

const NOOP = () => {};

/** Cap the inline description at ~90 characters of text-sm; anything longer
 *  truncates and is revealed in full by the hover tooltip below. When the row
 *  runs out of space, the description shrinks well before the title does so a
 *  long description can never crowd out the entity name. */
const DESCRIPTION_MAX_WIDTH_CLASS = 'max-w-[90ch] shrink-[8]';

/** Adornments yield the same way, for the same reason. They are normally short
 *  badges that never reach the shrink threshold, but a long one (an id chip on
 *  a digest-shaped object) would otherwise take the whole row: `shrink-0` here
 *  left the title, the only fully shrinkable item, to absorb every pixel of the
 *  shortfall — 70px of a 728px row in the case that prompted this. */
const ADORNMENT_SHRINK_CLASS = 'shrink-[8]';

function hasHistoryBackEntry() {
  const idx = window.history.state?.idx;
  return typeof idx === 'number' && idx > 0;
}

/**
 * Ancestor trail above the title. A single-item trail is still a `nav`/`ol` so
 * the markup doesn't change shape with depth. No `aria-current` anywhere: the
 * current page is the `h1`, not a crumb.
 */
function Breadcrumbs({ trail }: { trail: EditorHeaderBreadcrumb[] }) {
  if (trail.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-xs leading-none text-muted-foreground">
        {trail.map((crumb, index) => (
          <li
            key={crumb.to ?? crumb.label}
            className="flex min-w-0 items-center gap-1"
          >
            {index > 0 ? (
              <span aria-hidden className="shrink-0 text-muted-foreground/60">
                /
              </span>
            ) : null}
            {crumb.loading ? (
              // Not wrapped in the link: an anchor whose only content is a
              // placeholder has no accessible name.
              <Skeleton
                className="h-3 w-24 shrink-0"
                data-testid="breadcrumb-loading"
              />
            ) : crumb.to ? (
              <Link
                to={crumb.to}
                className="motion-colors block truncate no-underline hover:text-primary"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="block truncate">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Hover tooltip revealing the full (possibly truncated) description. */
function DescriptionTooltip({
  description,
  children,
}: {
  description: string;
  children: React.ReactElement;
}) {
  if (!description) {
    return children;
  }
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="max-w-md">{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Click-to-edit text shared by the header title and description: a trigger
 *  button that swaps to an inline input, committing on blur/Enter and
 *  reverting on Escape. Keyboard exits return focus to the trigger; blur
 *  exits leave focus wherever the user moved it. */
function InlineEditableText({
  value,
  displayText,
  onCommit,
  triggerAriaLabel,
  inputAriaLabel,
  inputPlaceholder,
  triggerClassName,
  inputClassName,
  testId,
  wrapTrigger = trigger => trigger,
}: {
  value: string;
  displayText: string;
  onCommit: (value: string) => void;
  triggerAriaLabel: string;
  inputAriaLabel: string;
  inputPlaceholder?: string;
  triggerClassName?: string;
  inputClassName?: string;
  testId?: string;
  wrapTrigger?: (trigger: React.ReactElement) => React.ReactElement;
}) {
  const {
    isEditing,
    localName,
    startEditing,
    handleChange,
    handleBlur,
    handleKeyDown,
  } = useEditableName({ name: value, onNameChange: onCommit });

  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const exitViaKeyboardRef = React.useRef(false);

  // Layout effect so the focus move happens synchronously with the swap
  // between trigger and input — a passive effect would let a frame render
  // with focus on <body>.
  React.useLayoutEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (exitViaKeyboardRef.current) {
      exitViaKeyboardRef.current = false;
      triggerRef.current?.focus();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={localName}
        onChange={e => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            exitViaKeyboardRef.current = true;
          }
          handleKeyDown(e);
        }}
        placeholder={inputPlaceholder}
        className={inputClassName}
        aria-label={inputAriaLabel}
      />
    );
  }

  return wrapTrigger(
    <button
      ref={triggerRef}
      type="button"
      onClick={startEditing}
      data-testid={testId}
      aria-label={triggerAriaLabel}
      className={triggerClassName}
    >
      {displayText}
    </button>,
  );
}

/**
 * Sticky top rail for detail/editor routes: back navigation, optional
 * breadcrumb, title and inline description (both optionally click-to-edit),
 * an "Unsaved" badge, and a manual Save button when `saveState="manual"`.
 * Reports its title to the app's document-title owner via
 * `EditorHeaderTitleProvider` while mounted. The `backTo` link prefers history
 * back when an in-app entry exists, so browser state is preserved.
 */
function EditorHeader({
  title,
  description,
  documentTitle,
  icon,
  titleAdornment,
  editable = false,
  onTitleChange,
  editableDescription = false,
  onDescriptionChange,
  descriptionPlaceholder = 'Add a description…',
  backTo,
  onBack,
  onBackClick,
  breadcrumb,
  breadcrumbPath,
  saveState = 'none',
  isDirty = false,
  saving = false,
  onSave,
  saveLabel = 'Save',
  savingLabel = 'Saving…',
  saveDisabled = false,
  saveButtonTestId,
  actions,
  trailingActions,
  className,
}: EditorHeaderProps) {
  const navigate = useNavigate();
  const canEdit = editable && !!onTitleChange;
  const canEditDescription = editableDescription && !!onDescriptionChange;
  const handleBackLinkClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onBackClick?.(event);
      if (event.defaultPrevented) {
        return;
      }
      if (hasHistoryBackEntry()) {
        event.preventDefault();
        navigate(-1);
      }
    },
    [navigate, onBackClick],
  );

  const registerDocumentTitle = useEditorHeaderTitleRegistry();
  const resolvedDocumentTitle = documentTitle ?? title;
  React.useEffect(
    () => registerDocumentTitle?.(resolvedDocumentTitle),
    [registerDocumentTitle, resolvedDocumentTitle],
  );

  const breadcrumbTrail = React.useMemo<EditorHeaderBreadcrumb[]>(() => {
    if (!breadcrumb) {
      return [];
    }
    return typeof breadcrumb === 'string'
      ? [{ label: breadcrumb, to: breadcrumbPath }]
      : breadcrumb;
  }, [breadcrumb, breadcrumbPath]);

  const hasBack = Boolean(backTo || onBack);
  // leading-tight keeps descenders inside the line box; leading-none + truncate clips them.
  const titleLeadingClass = 'leading-tight';

  return (
    <div
      className={cn(
        'sticky top-0 z-40 flex h-[70px] min-h-[70px] w-full min-w-0 shrink-0 items-center gap-3 border-b border-border/80 bg-background py-3',
        hasBack ? 'pr-4 pl-3 sm:pr-6' : 'px-4 sm:px-6',
        className,
      )}
    >
      {backTo ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          asChild
        >
          <Link to={backTo} onClick={handleBackLinkClick} aria-label="Back">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
      ) : onBack ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </Button>
      ) : null}

      {icon ? <span className="shrink-0 text-primary">{icon}</span> : null}

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <Breadcrumbs trail={breadcrumbTrail} />

        <div className="flex min-w-0 items-center gap-2">
          {canEdit ? (
            /* The h1 wraps the edit control so the page keeps its top-level
               heading while the title is editable (preflight makes the h1
               inherit font styles, so the control styles itself). Its
               aria-label overrides name-from-content, which would otherwise
               surface the trigger's "Edit title: …" label in heading
               navigation instead of the title itself. */
            <h1 className="min-w-0" aria-label={title}>
              <InlineEditableText
                value={title}
                displayText={title}
                onCommit={onTitleChange ?? NOOP}
                triggerAriaLabel={`Edit title: ${title}`}
                inputAriaLabel="Edit title"
                testId="editable-title-trigger"
                triggerClassName={cn(
                  'motion-opacity block max-w-full min-w-0 cursor-pointer truncate bg-transparent p-0 text-left text-lg font-semibold text-foreground hover:opacity-70',
                  titleLeadingClass,
                )}
                inputClassName={cn(
                  'w-full min-w-0 border-b-2 border-primary bg-transparent p-0 text-lg font-semibold text-foreground outline-none',
                  titleLeadingClass,
                )}
              />
            </h1>
          ) : (
            <h1
              className={cn(
                'min-w-0 truncate text-lg font-semibold text-foreground',
                titleLeadingClass,
              )}
            >
              {title}
            </h1>
          )}

          {titleAdornment ? (
            <div
              className={cn(
                'flex min-w-0 items-center gap-2 overflow-hidden',
                ADORNMENT_SHRINK_CLASS,
              )}
            >
              {titleAdornment}
            </div>
          ) : null}

          {/* Description sits inline after the slug adornment, capped at a
              max-width so it never crowds the row; overflow truncates and the
              full text shows in a hover/focus tooltip. */}
          {canEditDescription ? (
            <InlineEditableText
              value={description ?? ''}
              displayText={description || descriptionPlaceholder}
              onCommit={onDescriptionChange ?? NOOP}
              triggerAriaLabel={
                description
                  ? `Edit description: ${description}`
                  : 'Add a description'
              }
              inputAriaLabel="Edit description"
              inputPlaceholder={descriptionPlaceholder}
              testId="editable-description-trigger"
              triggerClassName={cn(
                'motion-opacity block min-w-0 cursor-pointer truncate bg-transparent p-0 text-left text-sm hover:opacity-70',
                DESCRIPTION_MAX_WIDTH_CLASS,
                description
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/60 italic',
              )}
              inputClassName={cn(
                'min-w-0 flex-1 border-b border-primary bg-transparent p-0 text-sm text-muted-foreground outline-none',
                DESCRIPTION_MAX_WIDTH_CLASS,
              )}
              wrapTrigger={trigger => (
                <DescriptionTooltip description={description ?? ''}>
                  {trigger}
                </DescriptionTooltip>
              )}
            />
          ) : description ? (
            <DescriptionTooltip description={description}>
              {/* Focusable so keyboard users can reach the tooltip that
                  reveals the truncated text — Radix only opens tooltips on
                  hover or focus, and a plain <p> can't receive focus. */}
              {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
              <p
                tabIndex={0}
                className={cn(
                  'min-w-0 truncate rounded-sm text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  DESCRIPTION_MAX_WIDTH_CLASS,
                )}
              >
                {description}
              </p>
              {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
            </DescriptionTooltip>
          ) : null}

          {saveState === 'manual' && isDirty ? (
            <Badge
              variant="warningSubtle"
              icon={<span className="size-1.5 rounded-full bg-warning" />}
              className="gap-1.5 rounded-full text-warning"
            >
              Unsaved
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {actions}

        {saveState === 'manual' ? (
          <Button
            onClick={onSave}
            disabled={saveDisabled}
            loading={saving}
            loadingText={savingLabel}
            size="sm"
            data-testid={saveButtonTestId}
          >
            <Save />
            {saveLabel}
          </Button>
        ) : null}

        {trailingActions}
      </div>
    </div>
  );
}

export { EditorHeader, type EditorHeaderProps, type EditorHeaderBreadcrumb };
