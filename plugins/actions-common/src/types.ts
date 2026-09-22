/**
 * Minimal structural JSON Schema type. Self-contained so that actions-common
 * has zero runtime/type dependencies. Ajv (in the backend/frontend) accepts
 * any plain object as a schema, so this shape is sufficient for our compiler.
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  [key: string]: unknown;
}

/** Supported parameter types (v1: flat scalars + a string array, no recursion). */
export type ParamType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array<string>';

/** A single input parameter definition. Flat — no nesting in v1. */
export interface ActionParam {
  name: string;
  type: ParamType;
  description?: string;
  required?: boolean;
  /**
   * Value applied at execute time when the input is omitted. Only meaningful
   * for non-required params; its JS type should match `type`.
   */
  default?: unknown;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Whether an action only reads external state ('read') or can mutate it
 * ('write'). Derived from step methods via `deriveActionMode`, with an
 * optional persisted per-action override (`mode`).
 */
export type ActionMode = 'read' | 'write';

export interface ActionHeader {
  key: string;
  value: string;
}

/** The HTTP request template executed against the selected integration. */
export interface HttpActionRequest {
  backendType?: 'http';
  method: HttpMethod;
  path: string;
  headers: ActionHeader[];
  /** Raw body template; `{{param}}` tokens substituted at execute time. */
  body: string;
}

export interface AwsServiceActionRequest {
  backendType: 'aws';
  mode: 'service-api';
  service: string;
  operation?: string;
  profile: string;
  region: string;
  method: HttpMethod;
  path: string;
  headers: ActionHeader[];
  body: string;
}

export type ActionRequest = HttpActionRequest | AwsServiceActionRequest;

/**
 * One step of an action. Steps run sequentially; later templates can reference
 * earlier outputs via `{{steps.<id>...}}` (any jsonata expression on `steps`).
 */
export interface ActionStep {
  /** Used in `{{steps.<id>...}}` references — must satisfy isValidStepId. */
  id: string;
  integrationId: string;
  request: ActionRequest;
}

/** Valid step id: a plain identifier so `steps.<id>` is a valid jsonata path. */
export const STEP_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Identifier-shaped words jsonata refuses as path steps. */
export const RESERVED_STEP_IDS = ['true', 'false', 'null'] as const;

/** Step-id validity (shared by backend schema and editor): an identifier
 *  jsonata accepts as a path step, so `steps.<id>` always parses. */
export function isValidStepId(id: string): boolean {
  return (
    STEP_ID_RE.test(id) &&
    !(RESERVED_STEP_IDS as readonly string[]).includes(id)
  );
}

/** Current state of an action (camelCase DTO). */
export interface Action {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  name: string;
  slug: string;
  description: string;
  parameters: ActionParam[];
  steps: ActionStep[];
  enabled: boolean;
  /** Manual read/write override; null/undefined means derive from steps. */
  mode?: ActionMode | null;
  /** Freeform metadata attached to the action (API-only for now). */
  metadata?: Record<string, unknown> | null;
  /** Resolved mode (override ?? derived) — populated on backend responses. */
  effectiveMode?: ActionMode;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** An append-only snapshot of an action's editable fields at a given version. */
export interface ActionVersion {
  id: string;
  actionId: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  version: number;
  name: string;
  slug: string;
  description: string;
  parameters: ActionParam[];
  steps: ActionStep[];
  enabled: boolean;
  mode?: ActionMode | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

/** Payload accepted when creating/updating an action. */
export interface ActionInput {
  name: string;
  /** Optional on create — derived from `name` server-side when omitted. */
  slug?: string;
  description?: string;
  parameters: ActionParam[];
  steps: ActionStep[];
  enabled?: boolean;
  mode?: ActionMode | null;
  metadata?: Record<string, unknown> | null;
}
