import * as React from 'react';
import CodeMirror, { type ReactCodeMirrorProps } from '@uiw/react-codemirror';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { cn } from '../lib/utils';

type EditorSetup = Exclude<ReactCodeMirrorProps['basicSetup'], boolean>;

export interface EditorDiagnostic {
  line: number;
  column?: number;
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

export interface EditorHandle {
  focus: () => void;
  readonly view: EditorView | null;
}

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  extensions?: Extension[];
  diagnostics?: EditorDiagnostic[];
  error?: string | null;
  id?: string;
  placeholder?: string;
  height?: string;
  minHeight?: string;
  maxHeight?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /**
   * Changes only when an external value should replace an in-progress edit.
   * Use this for explicit resets such as restoring a saved version.
   *
   * A pending local edit is only reconciled when the parent echoes it back
   * verbatim. A parent that normalizes `value` on the way back (trim, reformat)
   * breaks that match, so its later external updates are ignored until
   * `resetKey` changes — bump `resetKey` to force such an update through.
   */
  resetKey?: string | number;
  /**
   * Let the user drag-resize the editor vertically. The editor fills the
   * bordered wrapper (`height: 100%`), so pass a `height` (or `minHeight`) —
   * without one the wrapper has no size and the editor collapses.
   */
  resizable?: boolean;
  setup?: EditorSetup;
  className?: string;
  editorClassName?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  onCreateEditor?: (view: EditorView) => void;
}

const DEFAULT_SETUP: EditorSetup = {
  allowMultipleSelections: false,
  bracketMatching: true,
  closeBrackets: true,
  crosshairCursor: false,
  drawSelection: true,
  foldGutter: true,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  highlightSelectionMatches: false,
  lineNumbers: true,
  rectangularSelection: false,
  // basicSetup's defaultHighlightStyle is light-only; we install our own
  // --cm-* driven HighlightStyle below.
  syntaxHighlighting: false,
};

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-foreground)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
  },
  '.cm-content': {
    caretColor: 'var(--color-foreground)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-muted)',
    borderRightColor: 'var(--color-border)',
    color: 'var(--color-muted-foreground)',
  },
  '.cm-line': {
    padding: '0 0.5rem',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor:
      'color-mix(in srgb, var(--color-primary) 24%, transparent)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-popover)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-popover-foreground)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-accent)',
    color: 'var(--color-accent-foreground)',
  },
  '.cm-placeholder': {
    color: 'var(--color-muted-foreground)',
    fontStyle: 'italic',
  },
});

// CodeMirror's basicSetup ships `defaultHighlightStyle`, which is tuned for
// light backgrounds only — its token colors are near-invisible on the dark
// theme. We supply our own style driven by the --cm-* design tokens so syntax
// colors flip with the app theme (the vars are redefined under .dark). Colors
// are set here; weight/style live on the tag entry.
const highlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.moduleKeyword, t.operatorKeyword],
    color: 'var(--cm-keyword)',
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--cm-string)' },
  { tag: t.number, color: 'var(--cm-number)' },
  { tag: [t.bool, t.null, t.atom], color: 'var(--cm-bool)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--cm-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [t.propertyName, t.definition(t.propertyName)],
    color: 'var(--cm-property)',
  },
  {
    tag: [
      t.variableName,
      t.definition(t.variableName),
      t.local(t.variableName),
    ],
    color: 'var(--cm-variable)',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName],
    color: 'var(--cm-function)',
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName],
    color: 'var(--cm-type)',
  },
  { tag: t.operator, color: 'var(--cm-operator)' },
  {
    tag: [t.url, t.link],
    color: 'var(--cm-link)',
    textDecoration: 'underline',
  },
  { tag: t.heading, color: 'var(--cm-heading)', fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--cm-meta)' },
  { tag: t.invalid, color: 'var(--cm-invalid)' },
]);

function mapDiagnostics(
  doc: EditorView['state']['doc'],
  diagnostics: EditorDiagnostic[],
): Diagnostic[] {
  return diagnostics.flatMap(diagnostic => {
    if (
      !Number.isFinite(diagnostic.line) ||
      diagnostic.line < 1 ||
      diagnostic.line > doc.lines
    ) {
      return [];
    }

    const line = doc.line(diagnostic.line);
    const column = Math.max(1, diagnostic.column ?? 1);
    const from = Math.min(line.from + column - 1, line.to);
    const to = line.to > from ? line.to : Math.min(from + 1, doc.length);
    return [
      {
        from,
        to,
        message: diagnostic.message,
        severity: diagnostic.severity ?? 'error',
      },
    ];
  });
}

const Editor = React.forwardRef<EditorHandle, EditorProps>(
  (
    {
      value,
      onChange,
      extensions = [],
      diagnostics,
      error,
      id,
      placeholder,
      height,
      minHeight,
      maxHeight,
      readOnly = false,
      disabled = false,
      resetKey,
      resizable = false,
      setup,
      className,
      editorClassName,
      'aria-label': ariaLabel,
      'data-testid': dataTestId,
      onCreateEditor,
    },
    ref,
  ) => {
    const [localValue, setLocalValue] = React.useState(value);
    const [syncedValue, setSyncedValue] = React.useState(value);
    const [syncedResetKey, setSyncedResetKey] = React.useState(resetKey);
    const editorViewRef = React.useRef<EditorView | null>(null);
    const pendingValueRef = React.useRef<string | null>(null);
    const errorId = React.useId();
    const errorMessage = error ?? undefined;

    // Adopt external `value` changes during render (React's "adjust state on a
    // prop change" pattern). A stale controlled-value echo must not overwrite
    // a newer local edit; callers opt into overwriting that edit with resetKey.
    if (resetKey !== syncedResetKey) {
      setSyncedResetKey(resetKey);
      setSyncedValue(value);
      pendingValueRef.current = null;
      setLocalValue(value);
    } else if (value !== syncedValue) {
      setSyncedValue(value);
      if (value === pendingValueRef.current) {
        pendingValueRef.current = null;
      } else if (pendingValueRef.current === null) {
        setLocalValue(value);
      }
    }

    const applyDiagnostics = React.useCallback(
      (view = editorViewRef.current) => {
        if (!view) {
          return;
        }
        view.dispatch(
          setDiagnostics(
            view.state,
            mapDiagnostics(view.state.doc, diagnostics ?? []),
          ),
        );
      },
      [diagnostics],
    );

    React.useEffect(() => {
      applyDiagnostics();
    }, [applyDiagnostics]);

    const contentAttributes = React.useMemo(
      () =>
        EditorView.contentAttributes.of({
          ...(ariaLabel ? { 'aria-label': ariaLabel } : null),
          ...(errorMessage
            ? { 'aria-describedby': errorId, 'aria-invalid': 'true' }
            : null),
        }),
      [ariaLabel, errorId, errorMessage],
    );

    React.useImperativeHandle(
      ref,
      () => ({
        focus: () => editorViewRef.current?.focus(),
        get view() {
          return editorViewRef.current;
        },
      }),
      [],
    );

    const handleChange = React.useCallback(
      (nextValue: string) => {
        pendingValueRef.current = nextValue;
        setLocalValue(nextValue);
        onChange(nextValue);
      },
      [onChange],
    );

    const handleCreateEditor = React.useCallback(
      (view: EditorView) => {
        editorViewRef.current = view;
        applyDiagnostics(view);
        onCreateEditor?.(view);
      },
      [applyDiagnostics, onCreateEditor],
    );

    const resolvedExtensions = React.useMemo(
      () => [
        ...extensions,
        EditorView.lineWrapping,
        editorTheme,
        syntaxHighlighting(highlightStyle),
        contentAttributes,
        ...(diagnostics ? [lintGutter()] : []),
      ],
      [contentAttributes, diagnostics, extensions],
    );

    const resolvedSetup = React.useMemo(
      () => ({ ...DEFAULT_SETUP, ...setup }),
      [setup],
    );

    // When resizable, size the bordered wrapper and let CodeMirror fill it
    // (`height="100%"`). Applying fixed heights on CodeMirror itself leaves the
    // editing surface stuck while only the border grows on drag.
    const wrapperStyle = resizable
      ? {
          ...(height ? { height } : null),
          ...(minHeight ? { minHeight } : null),
          ...(maxHeight ? { maxHeight } : null),
        }
      : undefined;

    return (
      <div
        className={cn(
          'overflow-hidden rounded-md border bg-background shadow-sm focus-within:border-input-border-focus focus-within:ring-1 focus-within:ring-ring',
          errorMessage ? 'border-destructive' : 'border-input',
          disabled && 'cursor-not-allowed opacity-50',
          resizable && 'resize-y',
          className,
        )}
        style={wrapperStyle}
      >
        <CodeMirror
          basicSetup={resolvedSetup}
          className={cn(
            'h-full min-h-0 [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto [&_.cm-theme]:h-full',
            editorClassName,
          )}
          data-testid={dataTestId}
          extensions={resolvedExtensions}
          height={resizable ? '100%' : height}
          id={id}
          minHeight={resizable ? undefined : minHeight}
          maxHeight={resizable ? undefined : maxHeight}
          onChange={handleChange}
          onCreateEditor={handleCreateEditor}
          placeholder={placeholder}
          readOnly={readOnly || disabled}
          theme="none"
          value={localValue}
        />
        {errorMessage && (
          <p
            id={errorId}
            role="alert"
            className="px-3 py-1 text-xs text-destructive"
          >
            {errorMessage}
          </p>
        )}
      </div>
    );
  },
);
Editor.displayName = 'Editor';

export { Editor };
export type { EditorProps };
