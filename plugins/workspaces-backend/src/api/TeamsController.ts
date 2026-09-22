import {
  Router,
  json,
  type Request,
  type RequestHandler,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { validate as isUuid } from 'uuid';
import { SCOPES, SLUG_RE } from '@roadiehq/scopes';
import type { ScopeService } from '@roadiehq/scopes';
import { isUniqueViolation } from '@roadiehq/errors';
import type { HttpAuthService } from '@roadiehq/extensions-api';
import { TeamDao } from '../database';
import type { WorkspaceCreationPolicy } from '../creation-policy';
import type { WorkspaceMemberDirectory } from '../member-directory';
import { resolveWorkspaceCaller } from './caller';

const MAX_NAME_LENGTH = 200;

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };
type TeamStore = Pick<
  TeamDao,
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'listMembers'
  | 'addMember'
  | 'removeMember'
>;

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

export class TeamsController {
  constructor(
    private readonly teamDao: TeamStore,
    private readonly scopeService: ScopeService,
    private readonly httpAuth: HttpAuthService,
    private readonly memberDirectory: WorkspaceMemberDirectory,
    private readonly workspaceCreationPolicy: WorkspaceCreationPolicy = {
      isCreationEnabled: async () => true,
    },
  ) {}

  getRouter(): ExpressRouter {
    const router = Router();
    router
      .route('/')
      .get(this.scopeService.requireScopes(SCOPES.team.query), this.list)
      .post(
        this.scopeService.requireScopes(SCOPES.team.create),
        json(),
        this.create,
      );
    router
      .route('/:id')
      .patch(
        this.scopeService.requireScopes(SCOPES.team.create),
        json(),
        this.update,
      )
      .delete(this.scopeService.requireScopes(SCOPES.team.delete), this.delete);
    router
      .route('/:id/members')
      .get(this.scopeService.requireScopes(SCOPES.team.get), this.members)
      .post(
        this.scopeService.requireScopes(SCOPES.team.create),
        json(),
        this.addMember,
      );
    router.delete(
      '/:id/members/:userId',
      this.scopeService.requireScopes(SCOPES.team.delete),
      this.removeMember,
    );
    return router;
  }

  private async human(req: Request): Promise<boolean> {
    const caller = await resolveWorkspaceCaller(this.httpAuth, req);
    return Boolean(caller.userId) && !caller.service;
  }

  list: RequestHandler = async (req, res) => {
    if (!(await this.human(req))) {
      return res.status(403).json({ error: 'Teams require a user' });
    }
    return res.json({ teams: await this.teamDao.list() });
  };

  create: RequestHandler = async (req, res) => {
    const caller = await resolveWorkspaceCaller(this.httpAuth, req);
    if (!caller.userId || caller.service) {
      return res.status(403).json({ error: 'Teams require a user' });
    }
    if (!(await this.workspaceCreationPolicy.isCreationEnabled('team'))) {
      return res.status(403).json({ error: 'Team creation is disabled' });
    }
    const name = validateName(req.body?.name);
    if (!name.ok) {
      return res.status(400).json({ error: name.error });
    }
    const slug = req.body?.slug;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      return res.status(400).json({
        error: 'slug must be lowercase alphanumerics joined by single hyphens',
      });
    }
    try {
      return res.status(201).json(
        await this.teamDao.create(
          {
            name: name.value,
            slug,
          },
          caller.userId,
        ),
      );
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: `A team with slug '${slug}' already exists` });
      }
      return this.internalError(res, e);
    }
  };

  update: RequestHandler = async (req, res) => {
    if (!(await this.human(req))) {
      return res.status(403).json({ error: 'Teams require a user' });
    }
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid team ID' });
    }
    if (req.body?.slug !== undefined) {
      return res.status(400).json({ error: 'slug cannot be changed' });
    }
    const name = validateName(req.body?.name);
    if (!name.ok) {
      return res.status(400).json({ error: name.error });
    }
    const team = await this.teamDao.update(req.params.id, { name: name.value });
    return team
      ? res.json(team)
      : res.status(404).json({ error: 'Team not found' });
  };

  delete: RequestHandler = async (req, res) => {
    if (!(await this.human(req))) {
      return res.status(403).json({ error: 'Teams require a user' });
    }
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid team ID' });
    }
    return (await this.teamDao.delete(req.params.id)) > 0
      ? res.status(204).send()
      : res.status(404).json({ error: 'Team not found' });
  };

  members: RequestHandler = async (req, res) => {
    if (!(await this.human(req))) {
      return res.status(403).json({ error: 'Teams require a user' });
    }
    const team = await this.getTeam(req, res);
    if (!team) {
      return;
    }
    return res.json({ members: await this.teamDao.listMembers(team.id) });
  };

  addMember: RequestHandler = async (req, res) => {
    if (!(await this.human(req))) {
      return res.status(403).json({ error: 'Teams require a user' });
    }
    const team = await this.getTeam(req, res);
    if (!team) {
      return;
    }
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    try {
      const identity = await this.memberDirectory.resolveByEmail(email);
      if (!identity) {
        return res.status(404).json({ error: 'No user found for that email' });
      }
      return res
        .status(201)
        .json(await this.teamDao.addMember(team.id, identity));
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: 'That user is already in the team' });
      }
      return this.internalError(res, e);
    }
  };

  removeMember: RequestHandler = async (req, res) => {
    if (!(await this.human(req))) {
      return res.status(403).json({ error: 'Teams require a user' });
    }
    const team = await this.getTeam(req, res);
    if (!team) {
      return;
    }
    return (await this.teamDao.removeMember(team.id, req.params.userId)) > 0
      ? res.status(204).send()
      : res.status(404).json({ error: 'Team member not found' });
  };

  private async getTeam(req: Request, res: Response) {
    if (!isUuid(req.params.id)) {
      res.status(400).json({ error: 'Invalid team ID' });
      return undefined;
    }
    const team = await this.teamDao.get(req.params.id);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
    }
    return team;
  }

  private internalError(res: Response, e: unknown) {
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}
