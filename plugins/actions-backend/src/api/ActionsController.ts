import { Router, RequestHandler, json } from 'express';
import {
  SCOPES,
  SLUG_RE,
  resolveAllowedTargets,
  isTargetAllowed,
} from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import { isUniqueViolation } from '@roadiehq/errors';
import { validate as isUuid } from 'uuid';
import { z } from 'zod';
import Ajv from 'ajv';
import type {
  DiscoveryService,
  InternalFetchApi,
  LoggerService,
} from '@roadiehq/extensions-api';
import {
  entityChangeTopics,
  type EntityChangeOperation,
  type EventsService,
} from '@roadiehq/backend-defaults';
import {
  Action,
  ActionParam,
  ActionRequest,
  ActionStep,
  RESERVED_STEP_IDS,
  STEP_ID_RE,
  compileInputSchema,
  renderJsonTemplate,
  renderTemplate,
  slugify,
} from '@roadiehq/actions-common';
import { ActionDao, ActionFields } from '../database';
import { IntegrationsClient } from './IntegrationsClient';
import { resolveStepTokens, StepOutput } from './stepTokens';
import type { WorkspaceService } from '@roadiehq/workspaces-backend';
import {
  defaultCurrentScopeIdResolver,
  type CurrentScopeIdResolver,
} from '@roadiehq/integrations-node';

/** Outcome of one executed step, as reported in the envelope. */
interface StepResult extends StepOutput {
  id: string;
}

/**
 * Always-200 envelope returned by both stored and draft execution. Top-level
 * ok/status/data/error mirror the final executed step (the failed one when a
 * run halts), so single-step consumers (MCP, UI) read it unchanged; `steps`
 * carries every executed step's result in order.
 */
interface ExecuteEnvelope {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: unknown;
  steps: StepResult[];
}

const paramTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'array<string>',
]);

const actionParamSchema = z.object({
  name: z.string().min(1, 'parameter name is required'),
  type: paramTypeSchema,
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

const parametersSchema = z
  .array(actionParamSchema)
  .superRefine((params, ctx) => {
    const seen = new Set<string>();
    params.forEach((param, index) => {
      if (seen.has(param.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate parameter name '${param.name}'`,
          path: [index, 'name'],
        });
      }
      // reserved: `{{steps...}}` tokens resolve to step outputs
      if (param.name === 'steps') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `'steps' is reserved for step output references`,
          path: [index, 'name'],
        });
      }
      seen.add(param.name);
    });
  });

const httpRequestSchema = z.object({
  backendType: z.literal('http').optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string(),
  headers: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .default([]),
  body: z.string().default(''),
});

const awsServiceRequestSchema = z.object({
  backendType: z.literal('aws'),
  mode: z.literal('service-api'),
  service: z.string().min(1, 'service is required'),
  operation: z.string().optional(),
  profile: z.string().min(1, 'profile is required'),
  region: z.string().min(1, 'region is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string(),
  headers: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .default([]),
  body: z.string().default(''),
});

const requestSchema = z.union([awsServiceRequestSchema, httpRequestSchema]);

const stepSchema = z.object({
  id: z
    .string()
    .regex(
      STEP_ID_RE,
      'step id must be an identifier (letters, digits, underscores; not starting with a digit)',
    )
    .refine(id => !(RESERVED_STEP_IDS as readonly string[]).includes(id), {
      message: `step id must not be one of: ${RESERVED_STEP_IDS.join(', ')} (jsonata rejects these as path steps)`,
    }),
  integrationId: z.string().min(1, 'integrationId is required'),
  request: requestSchema,
});

const stepsSchema = z
  .array(stepSchema)
  .min(1, 'at least one step is required')
  .superRefine((steps, ctx) => {
    const seen = new Set<string>();
    steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate step id '${step.id}'`,
          path: [index, 'id'],
        });
      }
      seen.add(step.id);
    });
  });

const createBodySchema = z.object({
  name: z.string().min(1, 'name is required'),
  slug: z.string().regex(SLUG_RE, 'invalid slug').optional(),
  description: z.string().default(''),
  parameters: parametersSchema.default([]),
  steps: stepsSchema,
  enabled: z.boolean().default(true),
});

const updateBodySchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().regex(SLUG_RE, 'invalid slug').optional(),
  description: z.string().optional(),
  parameters: parametersSchema.optional(),
  steps: stepsSchema.optional(),
  enabled: z.boolean().optional(),
});

// Test-run an unsaved draft: the editor sends the on-screen step definitions
// directly so an action can be validated before it is created or updated.
const draftExecuteSchema = z.object({
  parameters: parametersSchema.default([]),
  steps: stepsSchema,
  inputs: z.record(z.string(), z.unknown()).default({}),
});

/** Attach the compiled JSON Schema so consumers (UI/MCP) never recompute it. */
function withInputSchema(action: Action) {
  return { ...action, inputSchema: compileInputSchema(action.parameters) };
}

export class ActionsController {
  private readonly actionDao: ActionDao;
  /** Credential-resolving fetch for internal calls (`internalFetchServiceRef`). */
  private readonly internalFetch: InternalFetchApi;
  private readonly discovery: DiscoveryService;
  private readonly scopeService: ScopeService;
  private readonly events: EventsService;
  private readonly logger: LoggerService;
  private readonly currentScopeIdResolver: CurrentScopeIdResolver;
  private readonly ajv: Ajv;
  private readonly workspaceService: WorkspaceService;
  private readonly workspaceIds = new WeakMap<object, string>();

  constructor(opts: {
    actionDao: ActionDao;
    internalFetch: InternalFetchApi;
    discovery: DiscoveryService;
    scopeService: ScopeService;
    events: EventsService;
    logger: LoggerService;
    workspaceService: WorkspaceService;
    currentScopeIdResolver?: CurrentScopeIdResolver;
  }) {
    this.actionDao = opts.actionDao;
    this.internalFetch = opts.internalFetch;
    this.discovery = opts.discovery;
    this.scopeService = opts.scopeService;
    this.events = opts.events;
    this.logger = opts.logger;
    this.currentScopeIdResolver =
      opts.currentScopeIdResolver ?? defaultCurrentScopeIdResolver;
    this.workspaceService = opts.workspaceService;
    // useDefaults lets Ajv fill omitted inputs from each param's `default`
    // (mutating `inputs`) before the template is rendered.
    this.ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });
  }

  private resolveWorkspace: RequestHandler = async (req, _res, next) => {
    try {
      this.workspaceIds.set(
        req,
        await this.workspaceService.resolveWorkspaceId(req),
      );
      next();
    } catch (error) {
      next(error);
    }
  };

  private workspaceId(req: object): string {
    const workspaceId = this.workspaceIds.get(req);
    if (!workspaceId) {
      throw new Error('Workspace middleware did not run');
    }
    return workspaceId;
  }

  private async publishChange(
    operation: EntityChangeOperation,
    id: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      const scopeId = await this.currentScopeIdResolver.getCurrentScopeId();
      await this.events.publish({
        topic: entityChangeTopics.actions,
        eventPayload: { id, operation, scopeId, workspaceId },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to publish ${operation} action event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;
    const requireScopeFamily = scopeService.requireScopeFamily;

    router.use(this.resolveWorkspace);

    // The listing admits the whole `action:query` family (incl. narrowed
    // `action:query:<slug>` grants); `list` then filters rows to those targets.
    router
      .route('/')
      .get(requireScopeFamily(SCOPES.action.query), this.list)
      .post(requireScopes(SCOPES.action.create), json(), this.create);
    // Single-segment, so it never collides with `/:idOrSlug/execute`.
    router
      .route('/execute')
      .post(requireScopes(SCOPES.action.execute), json(), this.draftExecute);
    // Registered before `/:id` so the literal prefix wins the match. Guarded by
    // `integration:delete` rather than `action:query`: the endpoint answers
    // "may this integration be deleted", and only ever returns integration
    // usage — so the authority it needs is the authority to delete one.
    router
      .route('/integration-usage/:integrationId')
      .get(requireScopes(SCOPES.integration.delete), this.integrationUsage);
    router
      .route('/:id')
      .get(requireScopes(SCOPES.action.get), this.get)
      .put(requireScopes(SCOPES.action.create), json(), this.replace)
      .patch(requireScopes(SCOPES.action.create), json(), this.update)
      .delete(requireScopes(SCOPES.action.delete), this.delete);
    router
      .route('/:id/versions')
      .get(requireScopes(SCOPES.action.query), this.listVersions);
    router
      .route('/:id/versions/:version')
      .get(requireScopes(SCOPES.action.get), this.getVersion);
    // Restoring a version mutates the action, so it's a `create` (update), not
    // an `execute` — `action:execute` means running the action, a different act.
    router
      .route('/:id/versions/:version/restore')
      .post(requireScopes(SCOPES.action.create), this.restoreVersion);
    router
      .route('/:idOrSlug/execute')
      .post(requireScopeFamily(SCOPES.action.execute), json(), this.execute);

    return router;
  }

  /**
   * Actions referencing an integration, for the integration delete guard.
   *
   * Deliberately not served off `list`: that applies row-level scope narrowing,
   * so a narrowed caller would see a subset and the guard would under-report —
   * a false "safe to delete".
   */
  integrationUsage: RequestHandler = async (req, res) => {
    try {
      const items = await this.actionDao.findByIntegrationId(
        req.params.integrationId,
        this.workspaceId(req),
      );
      return res.send({ items });
    } catch (e: unknown) {
      this.logger.error(
        `Failed to look up action integration usage: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return res.status(500).json({ error: 'Failed to look up usage' });
    }
  };

  list: RequestHandler = async (req, res) => {
    const { search, limit, offset } = req.query;
    try {
      // The route guard already admitted the `action:query` family; narrow the
      // rows to the targets the caller was granted (undefined => no restriction).
      const allowedIdentifiers = await resolveAllowedTargets(
        this.scopeService,
        req,
        SCOPES.action.query,
      );

      const result = await this.actionDao.list({
        search: typeof search === 'string' ? search : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        allowedIdentifiers,
        workspaceId: this.workspaceId(req),
      });
      return res.send({
        items: result.items.map(withInputSchema),
        total: result.total,
      });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  create: RequestHandler = async (req, res) => {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }

    const slug = parsed.data.slug ?? slugify(parsed.data.name);
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({
        error: 'Could not derive a valid slug from name; provide a slug',
      });
    }

    const fields: ActionFields = { ...parsed.data, slug };

    try {
      const result = await this.actionDao.create(fields, this.workspaceId(req));
      await this.publishChange('created', result.id, this.workspaceId(req));
      return res.status(201).send(withInputSchema(result));
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: `An action with slug '${slug}' already exists` });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  get: RequestHandler = async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid action ID' });
    }
    try {
      const result = await this.actionDao.get(id, this.workspaceId(req));
      if (!result) {
        return res.status(404).json({ error: 'Action not found' });
      }
      return res.send(withInputSchema(result));
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  update: RequestHandler = async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid action ID' });
    }

    const parsed = updateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }

    try {
      const result = await this.actionDao.update(
        id,
        parsed.data,
        this.workspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Action not found' });
      }
      await this.publishChange('updated', result.id, this.workspaceId(req));
      return res.send(withInputSchema(result));
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: `An action with that slug already exists` });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  replace: RequestHandler = async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid action ID' });
    }

    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const b = req.body ?? {};
      if (!b.name || !Array.isArray(b.steps) || b.steps.length === 0) {
        return res.status(400).json({
          error:
            'name and steps are required (PUT replaces the whole action; use PATCH to change one field)',
        });
      }
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }

    try {
      const result = await this.actionDao.update(
        id,
        parsed.data,
        this.workspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Action not found' });
      }
      await this.publishChange('updated', result.id, this.workspaceId(req));
      return res.send(withInputSchema(result));
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: `An action with that slug already exists` });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  delete: RequestHandler = async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid action ID' });
    }
    try {
      const deletedCount = await this.actionDao.delete(
        id,
        this.workspaceId(req),
      );
      if (deletedCount === 0) {
        return res.status(404).json({ error: 'Action not found' });
      }
      await this.publishChange('deleted', id, this.workspaceId(req));
      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listVersions: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { limit, offset } = req.query;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid action ID' });
    }
    try {
      const result = await this.actionDao.listVersions(id, {
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        workspaceId: this.workspaceId(req),
      });
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getVersion: RequestHandler = async (req, res) => {
    const { id, version } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid action ID' });
    }
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      return res.status(400).json({ error: 'Invalid version number' });
    }
    try {
      const result = await this.actionDao.getVersion(
        id,
        versionNum,
        this.workspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Version not found' });
      }
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  restoreVersion: RequestHandler = async (req, res) => {
    const { id, version } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid action ID' });
    }
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      return res.status(400).json({ error: 'Invalid version number' });
    }
    try {
      const result = await this.actionDao.restoreVersion(
        id,
        versionNum,
        this.workspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Action or version not found' });
      }
      await this.publishChange('restored', result.id, this.workspaceId(req));
      return res.send(withInputSchema(result));
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  /**
   * Render the action's request template with validated inputs and proxy it to
   * integrations-backend. Always responds 200 with an envelope reflecting the
   * integration outcome; only action-not-found (404) and invalid-inputs (400)
   * are non-200 (those are the actions plugin's own errors).
   */
  execute: RequestHandler = async (req, res) => {
    const { idOrSlug } = req.params;

    let action: Action | undefined;
    try {
      action = await this.actionDao.getByIdOrSlug(
        idOrSlug,
        this.workspaceId(req),
      );
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // Fine-grained scope: the family guard admitted any execute grant; enforce
    // that this caller's grant covers THIS action (by id or slug).
    if (
      !(await isTargetAllowed(this.scopeService, req, SCOPES.action.execute, [
        action.id,
        action.slug,
      ]))
    ) {
      return res.status(403).json({
        error: 'insufficient scope',
        missing: [`${SCOPES.action.execute}:${action.id}`],
      });
    }

    // MCP sets requireEnabled so disabled (draft) actions are not runnable by
    // agents; the UI test runner omits it so admins can test before enabling.
    if (req.body?.requireEnabled === true && !action.enabled) {
      return res.json({
        ok: false,
        status: 403,
        error: { message: 'Action is not enabled' },
        steps: [],
      });
    }

    const inputs: Record<string, unknown> =
      req.body &&
      typeof req.body.inputs === 'object' &&
      req.body.inputs !== null
        ? req.body.inputs
        : {};

    const validate = this.ajv.compile(compileInputSchema(action.parameters));
    if (!validate(inputs)) {
      return res
        .status(400)
        .json({ error: 'Invalid inputs', details: validate.errors });
    }

    return res.json(await this.executeSteps(action.steps, inputs));
  };

  /**
   * Execute an unsaved draft straight from the editor (used by the UI test
   * runner so an action can be verified before it is created or saved). Mirrors
   * `execute` but takes the request definition from the body rather than the DB.
   */
  draftExecute: RequestHandler = async (req, res) => {
    const parsed = draftExecuteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }
    const { parameters, steps, inputs } = parsed.data;

    const validate = this.ajv.compile(compileInputSchema(parameters));
    if (!validate(inputs)) {
      return res
        .status(400)
        .json({ error: 'Invalid inputs', details: validate.errors });
    }

    return res.json(await this.executeSteps(steps, inputs));
  };

  /**
   * Run steps sequentially; a failed step halts the run (no rollback — the
   * per-step results make earlier side effects visible).
   */
  private async executeSteps(
    steps: ActionStep[],
    inputs: Record<string, unknown>,
  ): Promise<ExecuteEnvelope> {
    const results: StepResult[] = [];
    const outputs: Record<string, StepOutput> = {};

    for (const step of steps) {
      let stepInputs = inputs;
      try {
        const awsTemplates =
          step.request.backendType === 'aws'
            ? [
                step.request.service,
                step.request.operation ?? '',
                step.request.profile,
                step.request.region,
              ]
            : [];
        const stepTokens = await resolveStepTokens(
          [
            step.request.path,
            step.request.body ?? '',
            ...step.request.headers.flatMap(h => [h.key, h.value]),
            ...awsTemplates,
          ],
          outputs,
        );
        if (Object.keys(stepTokens).length > 0) {
          stepInputs = { ...inputs, ...stepTokens };
        }
      } catch (e: unknown) {
        results.push({
          id: step.id,
          ok: false,
          status: 400,
          error: { message: e instanceof Error ? e.message : String(e) },
        });
        break;
      }

      const outcome = await this.renderAndProxy(step, stepInputs);
      results.push({ id: step.id, ...outcome });
      outputs[step.id] = outcome;
      if (!outcome.ok) {
        break;
      }
    }

    const last = results[results.length - 1];
    if (!last) {
      return {
        ok: false,
        status: 400,
        error: { message: 'Action has no steps to execute' },
        steps: [],
      };
    }
    return {
      ok: last.ok,
      status: last.status,
      ...(last.data !== undefined ? { data: last.data } : {}),
      ...(last.error !== undefined ? { error: last.error } : {}),
      steps: results,
    };
  }

  /**
   * Render a request template with validated inputs and proxy it to
   * integrations-backend. Returns the always-200 envelope reflecting the
   * integration outcome (fetch failures collapse to a 502 envelope).
   */
  private async renderAndProxy(
    spec: { integrationId: string; request: ActionRequest },
    inputs: Record<string, unknown>,
  ): Promise<StepOutput> {
    const { integrationId, request } = spec;

    // Rendering throws on template errors (e.g. an unregistered `{{fn()}}`);
    // surface that as a 400 envelope rather than a silent null/empty value
    // that lets the action "succeed".
    let renderedHeaders: Record<string, string>;
    let path: string;
    let body: string;
    try {
      renderedHeaders = {};
      for (const header of request.headers) {
        const key = renderTemplate(header.key, inputs).trim();
        if (!key) continue;
        renderedHeaders[key] = renderTemplate(header.value, inputs);
      }
      // URL-encode values rendered into the path so an input can't escape its
      // segment (path traversal, injected query string, or absolute URL).
      path = renderTemplate(request.path, inputs, encodeURIComponent);
      // Render the body as JSON so string inputs are escaped and can't inject
      // into or break the surrounding JSON (tokens are written unquoted).
      body = renderJsonTemplate(request.body ?? '', inputs);
    } catch (e) {
      return {
        ok: false,
        status: 400,
        error: { message: e instanceof Error ? e.message : String(e) },
      };
    }
    const method = request.method;

    let parsedBody: unknown;
    if (method !== 'GET' && body) {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        return {
          ok: false,
          status: 400,
          error: { message: 'Rendered request body is not valid JSON' },
        };
      }
    }

    if (request.backendType === 'aws') {
      let service: string;
      let operation: string | undefined;
      let profile: string;
      let region: string;
      try {
        service = renderTemplate(request.service, inputs);
        operation = request.operation
          ? renderTemplate(request.operation, inputs)
          : undefined;
        profile = renderTemplate(request.profile, inputs);
        region = renderTemplate(request.region, inputs);
      } catch (e: unknown) {
        return {
          ok: false,
          status: 400,
          error: { message: e instanceof Error ? e.message : String(e) },
        };
      }

      return this.proxyAwsServiceRequest({
        integrationId,
        service,
        operation,
        profile,
        region,
        method,
        path,
        body,
        renderedHeaders,
      });
    }

    try {
      const client = new IntegrationsClient(
        await this.discovery.getBaseUrl('integrations'),
        this.internalFetch,
      );

      return await client.request(integrationId, {
        backendType: 'http',
        method,
        path,
        headers: renderedHeaders,
        ...(method !== 'GET' && body ? { body: parsedBody } : {}),
      });
    } catch (e: unknown) {
      return {
        ok: false,
        status: 502,
        error: { message: e instanceof Error ? e.message : String(e) },
      };
    }
  }

  private async proxyAwsServiceRequest(options: {
    integrationId: string;
    service: string;
    operation?: string;
    profile: string;
    region: string;
    method: ActionRequest['method'];
    path: string;
    body: string;
    renderedHeaders: Record<string, string>;
  }): Promise<StepOutput> {
    const {
      integrationId,
      service,
      operation,
      profile,
      region,
      method,
      path,
      body,
      renderedHeaders,
    } = options;

    try {
      const client = new IntegrationsClient(
        await this.discovery.getBaseUrl('integrations'),
        this.internalFetch,
      );

      return await client.request(integrationId, {
        backendType: 'aws',
        mode: 'service-api',
        service,
        ...(operation ? { operation } : {}),
        profile,
        region,
        method,
        path,
        headers: renderedHeaders,
        ...(method !== 'GET' && body ? { body } : {}),
      });
    } catch (e: unknown) {
      return {
        ok: false,
        status: 502,
        error: { message: e instanceof Error ? e.message : String(e) },
      };
    }
  }
}

// Re-exported for tests/consumers that need the param shape.
export type { ActionParam };
