import type {
  Action,
  ActionMode,
  ActionParam,
  ActionStep,
  ActionVersion,
} from '@roadiehq/actions-common';
import { deriveActionMode } from '@roadiehq/actions-common';
import { workspaceOwnershipFields } from '@roadiehq/workspaces-backend';

export interface ActionRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string;
  parameters: unknown;
  steps: unknown;
  enabled: boolean;
  mode: ActionMode | null;
  metadata: unknown;
  current_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ActionVersionRow {
  id: string;
  action_id: string;
  workspace_id: string;
  version: number;
  name: string;
  slug: string;
  description: string;
  parameters: unknown;
  steps: unknown;
  enabled: boolean;
  mode: ActionMode | null;
  metadata: unknown;
  created_at: Date;
}

/** jsonb columns come back parsed (pg) or as text (other drivers) — handle both. */
function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function parseNullableJson<T>(value: unknown): T | null {
  return value === null || value === undefined ? null : parseJson<T>(value);
}

export function rowToAction(row: ActionRow): Action {
  const steps = parseJson<ActionStep[]>(row.steps);
  const mode = row.mode ?? null;
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    parameters: parseJson<ActionParam[]>(row.parameters),
    steps,
    enabled: row.enabled,
    mode,
    metadata: parseNullableJson<Record<string, unknown>>(row.metadata),
    effectiveMode: mode ?? deriveActionMode(steps),
    currentVersion: row.current_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToActionVersion(row: ActionVersionRow): ActionVersion {
  return {
    id: row.id,
    actionId: row.action_id,
    ...workspaceOwnershipFields(row.workspace_id),
    version: row.version,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parameters: parseJson<ActionParam[]>(row.parameters),
    steps: parseJson<ActionStep[]>(row.steps),
    enabled: row.enabled,
    mode: row.mode ?? null,
    metadata: parseNullableJson<Record<string, unknown>>(row.metadata),
    createdAt: row.created_at.toISOString(),
  };
}
