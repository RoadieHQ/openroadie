import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { LoggerService } from '@roadiehq/extensions-api';

const TABLE_NAME = 'github_app_install_requests';
const DEFAULT_TTL_DAYS = 30;

export interface GithubAppInstallRequestRow {
  id: string;
  app_id: string;
  host: string;
  org_login: string | null;
  created_at: Date;
  expires_at: Date;
}

export interface GithubAppInstallRequest {
  id: string;
  appId: string;
  host: string;
  orgLogin?: string;
  createdAt: string;
  expiresAt: string;
}

function rowToRequest(
  row: GithubAppInstallRequestRow,
): GithubAppInstallRequest {
  return {
    id: row.id,
    appId: row.app_id,
    host: row.host,
    orgLogin: row.org_login ?? undefined,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export class GithubAppInstallRequestDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({
      name: 'GithubAppInstallRequestDao',
    });
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<GithubAppInstallRequestRow>(TABLE_NAME);
  }

  async create(
    appId: string,
    host: string,
    orgLogin?: string,
  ): Promise<GithubAppInstallRequest> {
    const id = uuid();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.table().insert({
      id,
      app_id: appId,
      host,
      org_login: orgLogin ?? null,
      created_at: now,
      expires_at: expiresAt,
    });

    this.logger.info(
      `Created pending install request for app ${appId} on ${host}`,
    );

    return {
      id,
      appId,
      host,
      orgLogin,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listActive(): Promise<GithubAppInstallRequest[]> {
    const rows = await this.table()
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'asc');
    return rows.map(rowToRequest);
  }

  async findByAppAndHost(
    appId: string,
    host: string,
  ): Promise<GithubAppInstallRequest[]> {
    const rows = await this.table()
      .where({ app_id: appId, host })
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'asc');
    return rows.map(rowToRequest);
  }

  async list(appId?: string): Promise<GithubAppInstallRequest[]> {
    const query = this.table()
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'asc');
    if (appId) {
      query.where({ app_id: appId });
    }
    const rows = await query;
    return rows.map(rowToRequest);
  }

  async delete(id: string): Promise<void> {
    await this.table().where('id', id).delete();
    this.logger.info(`Deleted pending install request: ${id}`);
  }

  async deleteExpired(): Promise<number> {
    const count = await this.table()
      .where('expires_at', '<=', new Date())
      .delete();
    if (count > 0) {
      this.logger.info(`Cleaned up ${count} expired install request(s)`);
    }
    return count;
  }
}
