import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { NotFoundError } from '@roadiehq/errors';
import { LoggerService } from '@roadiehq/extensions-api';

const TABLE_NAME = 'github_app_installations';

export interface GithubAppInstallationRow {
  id: string;
  app_id: string;
  host: string;
  installation_id: string;
  org_login: string | null;
  org_url: string | null;
  avatar_url: string | null;
  permissions: unknown;
  repo_selection: string | null;
  installed_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GithubAppInstallation {
  id: string;
  appId: string;
  host: string;
  installationId: number;
  orgLogin?: string;
  orgUrl?: string;
  avatarUrl?: string;
  permissions?: Record<string, string>;
  repoSelection?: string;
  installedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertInstallationInput {
  appId: string;
  host?: string;
  installationId: number;
  orgLogin?: string;
  orgUrl?: string;
  avatarUrl?: string;
  permissions?: Record<string, string>;
  repoSelection?: string;
  installedBy?: string;
}

function rowToInstallation(
  row: GithubAppInstallationRow,
): GithubAppInstallation {
  return {
    id: row.id,
    appId: row.app_id,
    host: row.host,
    installationId: Number(row.installation_id),
    orgLogin: row.org_login ?? undefined,
    orgUrl: row.org_url ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    permissions: row.permissions
      ? (row.permissions as Record<string, string>)
      : undefined,
    repoSelection: row.repo_selection ?? undefined,
    installedBy: row.installed_by ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class GithubAppInstallationDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'GithubAppInstallationDao' });
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<GithubAppInstallationRow>(TABLE_NAME);
  }

  async upsert(input: UpsertInstallationInput): Promise<GithubAppInstallation> {
    const host = input.host ?? 'github.com';
    const existing = await this.table()
      .where({
        app_id: input.appId,
        host,
        installation_id: String(input.installationId),
      })
      .first();

    if (existing) {
      const updates: Partial<GithubAppInstallationRow> = {
        updated_at: new Date(),
      };
      if (input.orgLogin !== undefined) {
        updates.org_login = input.orgLogin;
      }
      if (input.orgUrl !== undefined) {
        updates.org_url = input.orgUrl;
      }
      if (input.avatarUrl !== undefined) {
        updates.avatar_url = input.avatarUrl;
      }
      if (input.permissions !== undefined) {
        updates.permissions = JSON.stringify(input.permissions);
      }
      if (input.repoSelection !== undefined) {
        updates.repo_selection = input.repoSelection;
      }
      if (input.installedBy !== undefined) {
        updates.installed_by = input.installedBy;
      }

      await this.table().where('id', existing.id).update(updates);
      this.logger.info(
        `Updated installation ${input.installationId} for app ${input.appId}`,
      );
      return this.getById(existing.id);
    }

    const id = uuid();
    const now = new Date();
    await this.table().insert({
      id,
      app_id: input.appId,
      host,
      installation_id: String(input.installationId),
      org_login: input.orgLogin ?? null,
      org_url: input.orgUrl ?? null,
      avatar_url: input.avatarUrl ?? null,
      permissions: input.permissions ? JSON.stringify(input.permissions) : null,
      repo_selection: input.repoSelection ?? null,
      installed_by: input.installedBy ?? null,
      created_at: now,
      updated_at: now,
    });
    this.logger.info(
      `Created installation ${input.installationId} for app ${input.appId}`,
    );
    return this.getById(id);
  }

  async getById(id: string): Promise<GithubAppInstallation> {
    const row = await this.table().where('id', id).first();
    if (!row) {
      throw new NotFoundError(`GitHub App Installation not found: ${id}`);
    }
    return rowToInstallation(row);
  }

  async getByInstallationId(
    appId: string,
    installationId: number,
    host: string = 'github.com',
  ): Promise<GithubAppInstallation> {
    const row = await this.table()
      .where({ app_id: appId, host, installation_id: String(installationId) })
      .first();
    if (!row) {
      throw new NotFoundError(
        `Installation not found: app ${appId} on ${host}, installation ${installationId}`,
      );
    }
    return rowToInstallation(row);
  }

  async getByOrg(
    appId: string,
    host: string,
    orgLogin: string,
  ): Promise<GithubAppInstallation | undefined> {
    const rows = await this.table()
      .where({ app_id: appId, host })
      .orderBy('created_at', 'desc');
    const row = rows.find(
      candidate =>
        candidate.org_login !== null &&
        candidate.org_login.toLowerCase() === orgLogin.toLowerCase(),
    );
    return row ? rowToInstallation(row) : undefined;
  }

  async list(appId?: string): Promise<GithubAppInstallation[]> {
    let query = this.table();
    if (appId) {
      query = query.where('app_id', appId);
    }
    const rows = await query.orderBy('created_at', 'desc');
    return rows.map(rowToInstallation);
  }

  async listAll(
    appId: string,
    host: string = 'github.com',
  ): Promise<GithubAppInstallation[]> {
    const rows = await this.table()
      .where({ app_id: appId, host })
      .orderBy('created_at', 'desc');
    return rows.map(rowToInstallation);
  }

  async delete(id: string): Promise<void> {
    const count = await this.table().where('id', id).delete();
    if (count === 0) {
      throw new NotFoundError(`GitHub App Installation not found: ${id}`);
    }
    this.logger.info(`Deleted installation: ${id}`);
  }

  async deleteByAppAndInstallationId(
    appId: string,
    installationId: number,
    host: string = 'github.com',
  ): Promise<{ orgLogin: string | undefined } | undefined> {
    const row = await this.table()
      .where({
        app_id: appId,
        host,
        installation_id: String(installationId),
      })
      .first();

    if (!row) {
      return undefined;
    }

    await this.table().where('id', row.id).delete();
    this.logger.info(
      `Deleted installation ${installationId} for app ${appId} on ${host} (org: ${row.org_login})`,
    );

    return {
      orgLogin: row.org_login ?? undefined,
    };
  }
}
