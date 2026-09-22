import { useMemo } from 'react';
import {
  FieldExpressionPicker,
  fieldOptionsFromPaths,
} from './field-expression-picker';

/**
 * Flatten a sampled integration response into JSONata leaf paths for the field
 * picker. Arrays are addressed by their first element (`[0]`) since a sample
 * can't tell us a wildcard is wanted; objects use dotted keys. Bounded in depth
 * and count so a large payload can't explode the option list. Switch to
 * Expression mode for wildcards/filters the picker can't express.
 */
export function responseFieldPaths(
  sample: unknown,
): { path: string; type: string }[] {
  const out: { path: string; type: string }[] = [];
  const MAX = 200;
  const walk = (node: unknown, path: string, depth: number) => {
    if (out.length >= MAX || depth > 5) {
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 0) {
        walk(node[0], `${path}[0]`, depth + 1);
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (out.length >= MAX) {
          return;
        }
        walk(value, path ? `${path}.${key}` : key, depth + 1);
      }
      return;
    }
    const type = node === null ? 'null' : typeof node;
    // Array-rooted paths start with `[`, so they attach to `$` directly;
    // object-rooted paths take the `$.` prefix.
    const jsonata = path ? `$${path.startsWith('[') ? '' : '.'}${path}` : '$';
    out.push({ path: jsonata, type });
  };
  walk(sample, '', 0);
  return out;
}

/**
 * The Lookup "Response field" — the same `FieldExpressionPicker` the Source and
 * Target fields use. Unlike those, the response has no static schema, so Field
 * mode is populated from the last sampled response and is only available once a
 * preview has produced one.
 */
export function ResponseField({
  value,
  onChange,
  sample,
  hasSample,
}: {
  value: string;
  onChange: (value: string) => void;
  sample: unknown;
  hasSample: boolean;
}) {
  const options = useMemo(
    () => fieldOptionsFromPaths(responseFieldPaths(sample)),
    [sample],
  );

  return (
    <FieldExpressionPicker
      heading="Response field"
      accessibleLabel="Response field"
      help="Extract values from the integration response to match against the target field."
      value={value}
      onChange={onChange}
      options={options}
      fieldDisabled={!hasSample}
      fieldPlaceholder={
        hasSample ? 'Select a response field' : 'Run a preview to list fields'
      }
      expressionPlaceholder="$.teams[*].slug"
      fieldNote={
        !hasSample && (
          <div className="text-xs text-muted-foreground">
            Run a preview to list fields from the response — or switch to an
            expression.
          </div>
        )
      }
    />
  );
}
