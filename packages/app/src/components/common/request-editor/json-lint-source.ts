import { jsonParseLinter } from '@codemirror/lang-json';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';

const jsonLinter = jsonParseLinter();

// jsonParseLinter flags an empty document (JSON.parse('') throws); an
// untouched editor must not show a squiggle.
export function jsonLintSource(view: EditorView): Diagnostic[] {
  return view.state.doc.length > 0 ? jsonLinter(view) : [];
}

// Some request bodies are JSON *templates*, not strict JSON — e.g. the actions
// editor embeds unquoted `{{param}}` / `{{steps.<id>...}}` tokens that leave the
// text unparseable until they're substituted at execute time. Skip linting
// whenever a template token is present (syntax highlighting still applies); lint
// normally once the body is plain JSON.
export function templateTolerantJsonLintSource(view: EditorView): Diagnostic[] {
  if (view.state.doc.length === 0) return [];
  if (view.state.doc.toString().includes('{{')) return [];
  return jsonLinter(view);
}
