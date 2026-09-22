import {
  Router,
  json,
  type Request,
  type RequestHandler,
  type Router as ExpressRouter,
} from 'express';
import { validate as isUuid } from 'uuid';
import { SCOPES, SLUG_RE, createScopeChecker, scope } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import { ConflictError, isUniqueViolation } from '@roadiehq/errors';
import type { HttpAuthService } from '@roadiehq/extensions-api';
import { WorkspaceDao } from '../database';
import type { WorkspaceService } from '../service';
import type { WorkspaceCreationPolicy } from '../creation-policy';
import type { WorkspaceMemberDirectory } from '../member-directory';
import {
  MAX_WORKSPACE_SVG_BYTES,
  SVG_PREFIX_RE,
  WORKSPACE_TYPES,
  type WorkspaceType,
} from '../types';
import { resolveWorkspaceCaller } from './caller';

/** Creating a personal workspace is the self-serve half of `workspace:create`;
 *  a holder of the un-narrowed scope satisfies it too. */
const CREATE_PERSONAL_SCOPE = scope('workspace', 'create', 'personal');

const MAX_NAME_LENGTH = 200;

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function isWorkspaceType(value: unknown): value is WorkspaceType {
  return WORKSPACE_TYPES.some(type => type === value);
}

function validateName(value: unknown): Validated<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: 'name must be a string' };
  }
  const name = value.trim();
  if (!name) {
    return { ok: false, error: 'name must not be empty' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `name must be at most ${MAX_NAME_LENGTH} characters`,
    };
  }
  return { ok: true, value: name };
}

/**
 * Accepts SVG markup for a workspace mark. The stored string is rendered by the
 * client through a `data:` URL in an `<img>`, which neither runs script nor
 * issues requests — so this checks shape and size rather than sanitising.
 */
function validateSvg(value: unknown): Validated<string | null> {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'svg must be a string or null' };
  }
  if (!SVG_PREFIX_RE.test(value)) {
    return { ok: false, error: 'svg must be SVG markup' };
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_WORKSPACE_SVG_BYTES) {
    return {
      ok: false,
      error: `svg must be at most ${MAX_WORKSPACE_SVG_BYTES} bytes`,
    };
  }
  return { ok: true, value };
}

export class WorkspacesController {
  private readonly workspaceDao: WorkspaceDao;
  private readonly scopeService: ScopeService;
  private readonly httpAuth: HttpAuthService;
  private readonly workspaceService: WorkspaceService;
  private readonly workspaceCreationPolicy: WorkspaceCreationPolicy;
  private readonly workspaceMemberDirectory: WorkspaceMemberDirectory;

  constructor(opts: {
    workspaceDao: WorkspaceDao;
    scopeService: ScopeService;
    httpAuth: HttpAuthService;
    workspaceService: WorkspaceService;
    workspaceCreationPolicy?: WorkspaceCreationPolicy;
    workspaceMemberDirectory?: WorkspaceMemberDirectory;
  }) {
    this.workspaceDao = opts.workspaceDao;
    this.scopeService = opts.scopeService;
    this.httpAuth = opts.httpAuth;
    this.workspaceService = opts.workspaceService;
    this.workspaceCreationPolicy = opts.workspaceCreationPolicy ?? {
      isCreationEnabled: async () => true,
    };
    this.workspaceMemberDirectory = opts.workspaceMemberDirectory ?? {
      resolveByEmail: async email => ({ userId: email, email }),
    };
  }

  private async serviceWorkspaceId(req: Request) {
    try {
      return await this.workspaceService.resolveWorkspaceId(req);
    } catch {
      return undefined;
    }
  }

  getRouter(): ExpressRouter {
    const router = Router();
    const requireScopes = this.scopeService.requireScopes;

    router
      .route('/')
      .get(requireScopes(SCOPES.workspace.query), this.list)
      // The route guard admits the narrowed personal grant; `create` raises the
      // bar to the un-narrowed scope when the body asks for an organization.
      .post(requireScopes(CREATE_PERSONAL_SCOPE), json(), this.create);

    router
      .route('/:id')
      .get(requireScopes(SCOPES.workspace.get), this.get)
      .patch(requireScopes(SCOPES.workspace.create), json(), this.update)
      .delete(requireScopes(SCOPES.workspace.delete), this.delete);

    router
      .route('/:id/members')
      .get(requireScopes(SCOPES.workspace.get), this.listMembers)
      .post(requireScopes(CREATE_PERSONAL_SCOPE), json(), this.addMember);

    router.delete(
      '/:id/members/:userId',
      requireScopes(SCOPES.workspace.delete),
      this.removeMember,
    );

    return router;
  }

  list: RequestHandler = async (req, res) => {
    const caller = await resolveWorkspaceCaller(this.httpAuth, req);
    if (caller.service) {
      const workspaceId = await this.serviceWorkspaceId(req);
      if (!workspaceId) {
        return res.json({ workspaces: [] });
      }
      const workspace = await this.workspaceDao.getForService(workspaceId);
      return res.json({ workspaces: workspace ? [workspace] : [] });
    }
    const workspaces = await this.workspaceDao.list(caller.userId);
    return res.json({
      workspaces: workspaces.map(workspace => ({
        ...workspace,
        canManage:
          workspace.type === 'organization' ||
          workspace.ownerUserId === caller.userId,
      })),
    });
  };

  get: RequestHandler = async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid workspace ID' });
    }
    const caller = await resolveWorkspaceCaller(this.httpAuth, req);
    const workspace = caller.service
      ? id === (await this.serviceWorkspaceId(req))
        ? await this.workspaceDao.getForService(id)
        : undefined
      : await this.workspaceDao.get(id, caller.userId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    return res.json({
      ...workspace,
      canManage:
        caller.service ||
        workspace.type === 'organization' ||
        workspace.ownerUserId === caller.userId,
    });
  };

  create: RequestHandler = async (req, res) => {
    const caller = await resolveWorkspaceCaller(this.httpAuth, req);
    if (caller.service) {
      return res
        .status(403)
        .json({ error: 'Service tokens cannot create workspaces' });
    }
    const { name: rawName, slug, type, svg: rawSvg } = req.body ?? {};

    const name = validateName(rawName);
    if (!name.ok) {
      return res.status(400).json({ error: name.error });
    }

    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      return res.status(400).json({
        error: 'slug must be lowercase alphanumerics joined by single hyphens',
      });
    }

    if (!isWorkspaceType(type) || type === 'team') {
      return res
        .status(400)
        .json({ error: 'type must be one of organization, personal' });
    }

    if (!(await this.workspaceCreationPolicy.isCreationEnabled(type))) {
      return res.status(403).json({ error: 'Workspace creation is disabled' });
    }

    const svg = validateSvg(rawSvg ?? null);
    if (!svg.ok) {
      return res.status(400).json({ error: svg.error });
    }

    if (type === 'organization') {
      const checker = createScopeChecker(
        await this.scopeService.getGrantedScopes(req),
      );
      if (!checker.allows(SCOPES.workspace.create)) {
        return res.status(403).json({
          error: 'insufficient scope',
          missing: [SCOPES.workspace.create],
        });
      }
    }

    const ownerUserId = caller.userId;
    if (type === 'personal' && !ownerUserId) {
      return res.status(403).json({
        error: 'A personal workspace requires an identified caller',
      });
    }

    try {
      const workspace = await this.workspaceDao.create({
        name: name.value,
        slug,
        type,
        svg: svg.value,
        // Taken from the caller, never from the body: ownership is not a field
        // a client gets to assert.
        ownerUserId,
      });
      return res.status(201).json(workspace);
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: `A workspace with slug '${slug}' already exists` });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  update: RequestHandler = async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid workspace ID' });
    }

    const { name: rawName, svg: rawSvg } = req.body ?? {};
    const patch: { name?: string; svg?: string | null } = {};

    if (rawName !== undefined) {
      const name = validateName(rawName);
      if (!name.ok) {
        return res.status(400).json({ error: name.error });
      }
      patch.name = name.value;
    }

    if (rawSvg !== undefined) {
      const svg = validateSvg(rawSvg);
      if (!svg.ok) {
        return res.status(400).json({ error: svg.error });
      }
      patch.svg = svg.value;
    }

    // Slug and type are fixed at create: a slug is an address, and changing a
    // type would orphan or capture ownership.
    if (req.body?.slug !== undefined || req.body?.type !== undefined) {
      return res
        .status(400)
        .json({ error: 'slug and type cannot be changed after create' });
    }

    const caller = await resolveWorkspaceCaller(this.httpAuth, req);
    if (caller.service && id !== (await this.serviceWorkspaceId(req))) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const workspace = caller.service
      ? await this.workspaceDao.updateForService(id, patch)
      : await this.workspaceDao.update(id, patch, caller.userId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    return res.json(workspace);
  };

  delete: RequestHandler = async (req, res) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid workspace ID' });
    }

    try {
      const caller = await resolveWorkspaceCaller(this.httpAuth, req);
      if (caller.service && id !== (await this.serviceWorkspaceId(req))) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      const deleted = caller.service
        ? await this.workspaceDao.deleteForService(id)
        : await this.workspaceDao.delete(id, caller.userId);
      if (deleted === 0) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      return res.status(204).send();
    } catch (e: unknown) {
      if (e instanceof ConflictError) {
        return res.status(409).json({ error: e.message });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listMembers: RequestHandler = async (req, res) => {
    const caller = await resolveWorkspaceCaller(this.httpAuth, req);
    if (caller.service || !caller.userId || !isUuid(req.params.id)) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const workspace = await this.workspaceDao.get(req.params.id, caller.userId);
    if (!workspace || workspace.type !== 'personal') {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    return res.json({
      members: await this.workspaceDao.listMembers(workspace.id),
      canManage: workspace.ownerUserId === caller.userId,
    });
  };

  addMember: RequestHandler = async (req, res) => {
    const workspace = await this.ownedWorkspace(req, req.params.id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    try {
      const identity =
        await this.workspaceMemberDirectory.resolveByEmail(email);
      if (!identity) {
        return res.status(404).json({ error: 'No user found for that email' });
      }
      const member = await this.workspaceDao.addMember(workspace.id, identity);
      return res.status(201).json(member);
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ error: 'That user already has access' });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  removeMember: RequestHandler = async (req, res) => {
    const workspace = await this.ownedWorkspace(req, req.params.id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const removed = await this.workspaceDao.removeMember(
      workspace.id,
      req.params.userId,
    );
    if (!removed) {
      return res.status(404).json({ error: 'Workspace member not found' });
    }
    return res.status(204).send();
  };

  private async ownedWorkspace(req: Request, id: string) {
    if (!isUuid(id)) {
      return undefined;
    }
    const caller = await resolveWorkspaceCaller(this.httpAuth, req);
    if (caller.service || !caller.userId) {
      return undefined;
    }
    const workspace = await this.workspaceDao.get(id, caller.userId);
    return workspace?.type === 'personal' &&
      workspace.ownerUserId === caller.userId
      ? workspace
      : undefined;
  }
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  if (
    email.length > 320 ||
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1]?.includes('.') ||
    /\s/.test(email)
  ) {
    return undefined;
  }
  return email;
}
