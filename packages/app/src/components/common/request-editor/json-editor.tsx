import { useMemo, useState } from 'react';
import { Editor } from '@roadiehq/ui/editor';
import { json } from '@codemirror/lang-json';
import { linter, type LintSource } from '@codemirror/lint';
import { jsonLintSource } from './json-lint-source';

interface JsonEditorProps {
  id: string;
  /**
   * Accessible name for the editor. CodeMirror's content div is a
   * `role="textbox"`, and a visible `<label htmlFor>` cannot name it (the id
   * lands on the wrapper), so this is required rather than optional.
   */
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  height?: string;
  minHeight?: string;
  maxHeight?: string;
  resizable?: boolean;
  placeholder?: string;
  error?: string | null;
  /**
   * The linter to run. Defaults to strict JSON parsing; pass
   * `templateTolerantJsonLintSource` for bodies that embed `{{…}}` template
   * tokens (see json-lint-source.ts).
   */
  lintSource?: LintSource;
  /** Render the document read-only (no editing), keeping highlighting. */
  readOnly?: boolean;
  /**
   * Bump when the parent programmatically replaces `value` (e.g. switching
   * integration) so the editor adopts the new value over in-flight edits.
   */
  resetKey?: string | number;
  'data-testid'?: string;
}

export function JsonEditor({
  id,
  ariaLabel,
  value,
  onChange,
  height = '140px',
  minHeight,
  maxHeight,
  resizable,
  placeholder,
  error,
  lintSource = jsonLintSource,
  readOnly = false,
  resetKey,
  'data-testid': dataTestId,
}: JsonEditorProps) {
  const [autoHeightState, setAutoHeightState] = useState(() => ({
    height: `${value.split(/\r\n|\r|\n/).length * 20 + 28}px`,
    resetKey,
  }));
  if (resetKey !== autoHeightState.resetKey) {
    setAutoHeightState({
      height: `${value.split(/\r\n|\r|\n/).length * 20 + 28}px`,
      resetKey,
    });
  }
  const extensions = useMemo(() => [json(), linter(lintSource)], [lintSource]);
  return (
    <Editor
      id={id}
      aria-label={ariaLabel}
      value={value}
      height={height === 'auto' ? autoHeightState.height : height}
      minHeight={minHeight}
      maxHeight={maxHeight}
      resizable={resizable}
      extensions={extensions}
      onChange={onChange}
      readOnly={readOnly}
      resetKey={resetKey}
      error={error}
      placeholder={placeholder}
      data-testid={dataTestId}
    />
  );
}
