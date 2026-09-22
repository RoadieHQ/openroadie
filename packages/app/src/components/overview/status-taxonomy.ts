import type { OverviewStatusTone } from './overview-status-cell';

/**
 * Canonical, single-sourced status taxonomy for the app's overview/detail
 * surfaces. Every feature that shows a status label pulls its wording and tone
 * from here so the same concept can't drift into three spellings across pages.
 *
 * Shape: each axis is ONE const mapping a state → {@link StatusMeta} (label +
 * tone), so the label and its colour never drift apart and every axis reads the
 * same way. Read a known state directly (`READINESS.ready.label`); read a
 * variable-key state through {@link statusValue} (`statusValue(EXECUTION, o).label`).
 *
 * DISPLAY vs VALUE: this module owns **display only** — the human label and the
 * dot tone. It never redefines backend wire values (`execution.status`,
 * `SecretStatusType`, `?status=` query params); those stay where they are and
 * are mapped into these axes at the display boundary.
 */

/** The display metadata every taxonomy state carries. */
export interface StatusMeta {
  label: string;
  tone: OverviewStatusTone;
}

/**
 * Read a taxonomy entry by a variable (non-literal) key. The key is always a
 * compile-time union, never user input, so this is safe — the one place we
 * suppress the object-injection rule instead of a switch per axis.
 */
export function statusValue<K extends string, V>(map: Record<K, V>, key: K): V {
  // eslint-disable-next-line security/detect-object-injection -- key is a typed union, never user input
  return map[key];
}

/* ------------------------------------------------------------------ *
 * Axis A — setup readiness (the "Setup" column / Status field)
 * ------------------------------------------------------------------ */

export type ReadinessState = 'ready' | 'needsSetup' | 'needsIntegrationSetup';

export const READINESS = {
  ready: { label: 'Ready', tone: 'success' },
  needsSetup: { label: 'Needs setup', tone: 'warning' },
  needsIntegrationSetup: { label: 'Needs integration setup', tone: 'warning' },
} as const satisfies Record<ReadinessState, StatusMeta>;

/**
 * The specific "why not ready" reasons, shown in the status tooltip / drawer
 * banner. Shared by data sources (`readiness.ts`) and integrations
 * (`integration-status-badges.tsx`) so both render the same sentence for the
 * same underlying secret/config problem.
 */
export const READINESS_REASON = {
  integrationUnavailable: 'Selected integration is unavailable',
  noIntegration: 'No integration selected',
  configRequired: 'Integration configuration required',
  setupRequired: 'Integration setup required',
  sourceEndpointNotConfigured: 'Source endpoint not configured',
} as const;

/** "N required secret(s) missing" — the canonical missing-secrets reason. */
export function missingSecretsReason(count: number): string {
  return `${count} required secret${count === 1 ? '' : 's'} missing`;
}

/* ------------------------------------------------------------------ *
 * Axis B — lifecycle (enabled / disabled)
 * ------------------------------------------------------------------ */

export type LifecycleStatus = 'enabled' | 'disabled';

export const LIFECYCLE = {
  enabled: { label: 'Enabled', tone: 'success' },
  disabled: { label: 'Disabled', tone: 'muted' },
} as const satisfies Record<LifecycleStatus, StatusMeta>;

/** Derive the lifecycle state from the `enabled` boolean. */
export function getLifecycleStatus(enabled: boolean): LifecycleStatus {
  return enabled ? 'enabled' : 'disabled';
}

/** Menu/button label for the toggle action (the verb, not the state). */
export function getToggleActionLabel(isEnabled: boolean): string {
  return isEnabled ? 'Disable' : 'Enable';
}

/** Lowercase verb for toast/error copy ("Failed to {verb} …"). */
export function getToggleActionVerb(nextEnabled: boolean): string {
  return nextEnabled ? 'enable' : 'disable';
}

/* ------------------------------------------------------------------ *
 * Axis C — execution / last-run outcome
 * ------------------------------------------------------------------ */

export type ExecutionOutcome =
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'running'
  | 'never';

export const EXECUTION = {
  succeeded: { label: 'Completed', tone: 'success' },
  partial: { label: 'Completed with errors', tone: 'warning' },
  failed: { label: 'Failed', tone: 'destructive' },
  running: { label: 'Running', tone: 'muted' },
  never: { label: 'Never run', tone: 'muted' },
} as const satisfies Record<ExecutionOutcome, StatusMeta>;

/**
 * Classify a last-run outcome from the raw execution fields. Callers pass the
 * **non-dry-run** execution (dry runs are excluded upstream). Single source of
 * truth for the `running` / `failed` / `partial-success` / `never` logic the
 * overview Run column and the objects context header both need.
 */
export function toExecutionOutcome(input: {
  status?: string;
  objectCount?: number;
  lastRunAt?: string | null;
}): ExecutionOutcome {
  // An in-flight run reports a non-empty `lastRunAt` (its start time, plus the
  // optimistic "run started" write) and often a stale `objectCount` from the
  // previous run — so it must be classified as running BEFORE the failed /
  // succeeded / never logic, or a retriggered run flashes green mid-flight.
  if (input.status === 'running' || input.status === 'pending') {
    return 'running';
  }
  if (!input.lastRunAt) {
    return 'never';
  }
  const failed = input.status === 'failed';
  const partial = failed && (input.objectCount ?? 0) > 0;
  if (partial) return 'partial';
  if (failed) return 'failed';
  return 'succeeded';
}

/* ------------------------------------------------------------------ *
 * Axis D — secret value presence (Configured / Not set)
 * ------------------------------------------------------------------ */

export type SecretPresence = 'configured' | 'notSet';

export const SECRET = {
  configured: { label: 'Configured', tone: 'success' },
  notSet: { label: 'Not set', tone: 'muted' },
} as const satisfies Record<SecretPresence, StatusMeta>;
