import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { NotAllowedError, NotFoundError } from '@roadiehq/errors';
import { LoggerService } from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

const TABLE_NAME = 'github_apps';

export interface GithubAppRow {
  id: string;
  app_id: string;
  host: string;
  purposes: unknown;
  slug: string | null;
  html_url: string | null;
  description: string | null;
  private_key_ref: string | null;
  kms_key_id: string | null;
  webhook_secret_ref: string | null;
  client_id: string | null;
  client_secret_ref: string | null;
  integration_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface GithubApp {
  id: string;
  appId: string;
  host: string;
  purposes?: string[];
  slug?: string;
  htmlUrl?: string;
  description?: string;
  privateKeyRef?: string;
  kmsKeyId?: string;
  webhookSecretRef?: string;
  clientId?: string;
  clientSecretRef?: string;
  integrationId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubAppWithWorkspace {
  app: GithubApp;
  workspaceId?: string;
}

export interface UpsertGithubAppInput {
  workspaceId: string;
  appId: string;
  host?: string;
  purposes?: string[];
  slug?: string | null;
  htmlUrl?: string | null;
  description?: string | null;
  privateKeyRef?: string | null;
  kmsKeyId?: string | null;
  webhookSecretRef?: string | null;
  clientId?: string | null;
  clientSecretRef?: string | null;
  integrationId?: string;
}

function rowToGithubApp(row: GithubAppRow): GithubApp {
  return {
    id: row.id,
    appId: row.app_id,
    host: row.host,
    purposes: normalizePurposes(row.purposes),
    slug: row.slug ?? undefined,
    htmlUrl: row.html_url ?? undefined,
    description: row.description ?? undefined,
    privateKeyRef: row.private_key_ref ?? undefined,
    kmsKeyId: row.kms_key_id ?? undefined,
    webhookSecretRef: row.webhook_secret_ref ?? undefined,
    clientId: row.client_id ?? undefined,
    clientSecretRef: row.client_secret_ref ?? undefined,
    integrationId: row.integration_id ?? undefined,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function normalizePurposes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string');
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (value): value is string => typeof value === 'string',
        );
      }
    } catch {
      return [];
    }
  }
  return [];
}

export class GithubAppDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'GithubAppDao' });
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<GithubAppRow>(TABLE_NAME);
  }

  async upsertApp(input: UpsertGithubAppInput): Promise<GithubApp> {
    const host = input.host ?? 'github.com';
    const existing = await this.table()
      .where({ app_id: input.appId, host })
      .first();

    if (existing) {
      if (
        !existing.integration_id &&
        input.workspaceId !== DEFAULT_WORKSPACE_ID
      ) {
        throw new NotAllowedError(
          `GitHub App ${input.appId} on ${host} belongs to another workspace`,
        );
      }
      if (existing.integration_id) {
        const owningIntegration = await this.knex('integrations')
          .where({
            id: existing.integration_id,
            workspace_id: input.workspaceId,
          })
          .first();
        if (!owningIntegration) {
          throw new NotAllowedError(
            `GitHub App ${input.appId} on ${host} belongs to another workspace`,
          );
        }
      }

      const updates: Partial<GithubAppRow> = { updated_at: new Date() };
      if (input.purposes !== undefined) {
        updates.purposes = JSON.stringify(input.purposes);
      }
      if (input.slug !== undefined) {
        updates.slug = input.slug;
      }
      if (input.htmlUrl !== undefined) {
        updates.html_url = input.htmlUrl;
      }
      if (input.description !== undefined) {
        updates.description = input.description;
      }
      if (input.privateKeyRef !== undefined) {
        updates.private_key_ref = input.privateKeyRef;
      }
      if (input.kmsKeyId !== undefined) {
        updates.kms_key_id = input.kmsKeyId;
      }
      if (input.webhookSecretRef !== undefined) {
        updates.webhook_secret_ref = input.webhookSecretRef;
      }
      if (input.clientId !== undefined) {
        updates.client_id = input.clientId;
      }
      if (input.clientSecretRef !== undefined) {
        updates.client_secret_ref = input.clientSecretRef;
      }
      if (input.integrationId !== undefined) {
        updates.integration_id = input.integrationId;
      }

      await this.table().where('id', existing.id).update(updates);
      this.logger.info(`Updated github app: ${input.appId} on ${host}`);
      return this.getById(existing.id);
    }

    if (!input.integrationId && input.workspaceId !== DEFAULT_WORKSPACE_ID) {
      throw new NotAllowedError(
        `GitHub App ${input.appId} on ${host} must be linked to an integration in this workspace`,
      );
    }

    const id = uuid();
    const now = new Date();
    await this.table().insert({
      id,
      app_id: input.appId,
      host,
      purposes: JSON.stringify(input.purposes ?? []),
      slug: input.slug ?? null,
      html_url: input.htmlUrl ?? null,
      description: input.description ?? null,
      private_key_ref: input.privateKeyRef ?? null,
      kms_key_id: input.kmsKeyId ?? null,
      webhook_secret_ref: input.webhookSecretRef ?? null,
      client_id: input.clientId ?? null,
      client_secret_ref: input.clientSecretRef ?? null,
      integration_id: input.integrationId ?? null,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    this.logger.info(`Created github app: ${input.appId} on ${host}`);
    return this.getById(id);
  }

  async getById(id: string): Promise<GithubApp> {
    const row = await this.table().where('id', id).first();
    if (!row) {
      throw new NotFoundError(`GitHub App not found: ${id}`);
    }
    return rowToGithubApp(row);
  }

  async getByAppId(appId: string, host?: string): Promise<GithubApp> {
    if (host) {
      const row = await this.table().where({ app_id: appId, host }).first();
      if (!row) {
        throw new NotFoundError(`GitHub App not found: ${appId} on ${host}`);
      }
      return rowToGithubApp(row);
    }

    const rows = await this.table().where({ app_id: appId }).limit(2);
    if (rows.length === 0) {
      throw new NotFoundError(`GitHub App not found: ${appId}`);
    }
    if (rows.length > 1) {
      throw new Error(
        `Multiple GitHub Apps found for app_id ${appId}. Specify host.`,
      );
    }
    return rowToGithubApp(rows[0]);
  }

  async getByIntegrationId(
    integrationId: string,
  ): Promise<GithubApp | undefined> {
    const row = await this.table()
      .where({ integration_id: integrationId, status: 'active' })
      .first();
    return row ? rowToGithubApp(row) : undefined;
  }

  async getByIntegrationIdAndPurpose(
    integrationId: string,
    purpose: string,
  ): Promise<GithubApp | undefined> {
    const rows = await this.table()
      .where({ integration_id: integrationId, status: 'active' })
      .orderBy('updated_at', 'desc');
    const row = rows.find(candidate =>
      normalizePurposes(candidate.purposes).includes(purpose),
    );
    return row ? rowToGithubApp(row) : undefined;
  }

  async getByHostAndPurpose(
    host: string,
    purpose: string,
  ): Promise<GithubApp | undefined> {
    const rows = await this.table()
      .where({ host, status: 'active' })
      .orderBy('updated_at', 'desc');
    const row = rows.find(candidate =>
      normalizePurposes(candidate.purposes).includes(purpose),
    );
    return row ? rowToGithubApp(row) : undefined;
  }

  async listAppsByHost(host: string): Promise<GithubApp[]> {
    const rows = await this.table()
      .where({ host, status: 'active' })
      .orderBy('created_at', 'desc');
    return rows.map(rowToGithubApp);
  }

  async listAppsByAppId(appId: string): Promise<GithubApp[]> {
    const rows = await this.table()
      .where({ app_id: appId, status: 'active' })
      .orderBy('created_at', 'desc');
    return rows.map(rowToGithubApp);
  }

  async listApps(): Promise<GithubApp[]> {
    const rows = await this.table()
      .where('status', 'active')
      .orderBy('created_at', 'desc');
    return rows.map(rowToGithubApp);
  }

  async listAppsWithWorkspaces(): Promise<GithubAppWithWorkspace[]> {
    const rows = await this.table()
      .leftJoin('integrations', 'github_apps.integration_id', 'integrations.id')
      .select('github_apps.*', 'integrations.workspace_id')
      .where('github_apps.status', 'active')
      .orderBy('github_apps.created_at', 'desc');
    return rows.map(row => ({
      app: rowToGithubApp(row),
      workspaceId: row.workspace_id ?? undefined,
    }));
  }

  async listAppsByWorkspaceId(workspaceId: string): Promise<GithubApp[]> {
    const rows = await this.table()
      .leftJoin('integrations', 'github_apps.integration_id', 'integrations.id')
      .select('github_apps.*')
      .where('github_apps.status', 'active')
      .where(builder => {
        builder.where('integrations.workspace_id', workspaceId);
        if (workspaceId === DEFAULT_WORKSPACE_ID) {
          builder.orWhereNull('github_apps.integration_id');
        }
      })
      .orderBy('github_apps.created_at', 'desc');
    return rows.map(rowToGithubApp);
  }

  async listAppsByIntegrationId(integrationId: string): Promise<GithubApp[]> {
    const rows = await this.table()
      .where({ integration_id: integrationId, status: 'active' })
      .orderBy('created_at', 'desc');
    return rows.map(rowToGithubApp);
  }

  async updateApp(
    id: string,
    updates: Partial<UpsertGithubAppInput>,
  ): Promise<GithubApp> {
    const existing = await this.table().where('id', id).first();
    if (!existing) {
      throw new NotFoundError(`GitHub App not found: ${id}`);
    }

    const patch: Partial<GithubAppRow> = { updated_at: new Date() };
    if (updates.appId !== undefined) {
      patch.app_id = updates.appId;
    }
    if (updates.host !== undefined) {
      patch.host = updates.host;
    }
    if (updates.purposes !== undefined) {
      patch.purposes = JSON.stringify(updates.purposes);
    }
    if (updates.slug !== undefined) {
      patch.slug = updates.slug;
    }
    if (updates.htmlUrl !== undefined) {
      patch.html_url = updates.htmlUrl;
    }
    if (updates.description !== undefined) {
      patch.description = updates.description;
    }
    if (updates.privateKeyRef !== undefined) {
      patch.private_key_ref = updates.privateKeyRef;
    }
    if (updates.kmsKeyId !== undefined) {
      patch.kms_key_id = updates.kmsKeyId;
    }
    if (updates.webhookSecretRef !== undefined) {
      patch.webhook_secret_ref = updates.webhookSecretRef;
    }
    if (updates.clientId !== undefined) {
      patch.client_id = updates.clientId;
    }
    if (updates.clientSecretRef !== undefined) {
      patch.client_secret_ref = updates.clientSecretRef;
    }
    if (updates.integrationId !== undefined) {
      patch.integration_id = updates.integrationId;
    }

    await this.table().where('id', id).update(patch);
    this.logger.info(`Updated github app ${id}`);
    return this.getById(id);
  }

  async deleteApp(id: string): Promise<void> {
    const existing = await this.table().where('id', id).first();
    if (!existing) {
      throw new NotFoundError(`GitHub App not found: ${id}`);
    }

    await this.knex.transaction(async trx => {
      await trx('github_app_installations')
        .where({ app_id: existing.app_id, host: existing.host })
        .delete();
      await trx('github_app_install_requests')
        .where({ app_id: existing.app_id, host: existing.host })
        .delete()
        .catch(() => undefined);
      await this.table(trx).where('id', id).delete();
    });
    this.logger.info(`Deleted github app ${id}`);
  }
}
