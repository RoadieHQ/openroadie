import jsonataSafe from '@roadiehq/jsonata-safe';
import { findTemplateTokens } from '@roadiehq/actions-common';

/**
 * What a step exposes to later steps' templates: the execute envelope of that
 * step, so references read naturally as `steps.<id>.data.<path>`.
 */
export interface StepOutput {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: unknown;
}

/** A token references step outputs when it starts a jsonata path on `steps`. */
function isStepToken(expr: string): boolean {
  return expr.startsWith('steps.') || expr.startsWith('steps[');
}

/**
 * Evaluate every `{{steps...}}` token in `templates` as a jsonata-safe
 * expression against earlier step outputs. Returns a map keyed by the exact
 * trimmed token content (merged into render `inputs`; the renderer looks
 * tokens up verbatim, so dotted keys need no renderer changes). Throws on an
 * unparseable expression AND on one that resolves to nothing — rendering a
 * typo as ''/null would fire a corrupted request at a live integration.
 */
export async function resolveStepTokens(
  templates: string[],
  stepOutputs: Record<string, StepOutput>,
): Promise<Record<string, unknown>> {
  const expressions = new Set<string>();
  for (const template of templates) {
    for (const token of findTemplateTokens(template)) {
      if (isStepToken(token.expr)) {
        expressions.add(token.expr);
      }
    }
  }

  const resolved: Record<string, unknown> = {};
  for (const expr of expressions) {
    let value: unknown;
    try {
      value = await jsonataSafe(expr).evaluate({ steps: stepOutputs });
    } catch (e: unknown) {
      // jsonata throws plain objects with a `message`, not Error instances.
      const message =
        typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e);
      throw new Error(
        `Failed to evaluate step reference '{{${expr}}}': ${message}`,
      );
    }
    if (value === undefined) {
      const known = Object.keys(stepOutputs);
      throw new Error(
        `Step reference '{{${expr}}}' resolved to no value. ` +
          (known.length > 0
            ? `Steps executed so far: ${known.join(', ')}. `
            : 'No steps have executed yet (references must point to earlier steps). ') +
          'Check the step id and path.',
      );
    }
    // strip jsonata's non-index `sequence` marker from result arrays
    resolved[expr] = Array.isArray(value) ? Array.from(value) : value;
  }
  return resolved;
}
