/*
 * Copyright 2020 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/backend-defaults/src/entrypoints/database/connectors/postgres.ts at v1.47.1, and modified.
 */

import { ConfigReader, readDurationFromConfig } from '@roadiehq/config';
import { ForwardedError } from '../../../errors';
import { durationToMilliseconds, JsonObject } from '../../../types';
import type { Knex } from 'knex';
import knexFactory from 'knex';
import { merge, omit } from 'lodash';
import limiterFactory from 'p-limit';
import format from 'pg-format';
import { mergeDatabaseConfig } from './mergeDatabaseConfig';
import type {
  LifecycleService,
  LoggerService,
  RootConfigService,
} from '@roadiehq/extensions-api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCredential = any;

interface PluginDeps {
  logger: LoggerService;
  lifecycle: LifecycleService;
}

const ddlLimiter = limiterFactory(1);

async function createPgDatabaseClient(
  dbConfig: RootConfigService,
  overrides?: Partial<Knex.Config>,
): Promise<Knex> {
  const knexConfig = await buildPgDatabaseConfig(dbConfig, overrides);
  const database = knexFactory(knexConfig);

  const role = dbConfig.getOptionalString('role');
  if (role) {
    database.client.pool.on(
      'createSuccess',
      async (
        _event: unknown,
        pgClient: { query: (q: string) => Promise<void> },
      ) => {
        const query = format('SET ROLE %I', role);
        await pgClient.query(query);
      },
    );
  }

  return database;
}

async function buildPgDatabaseConfig(
  dbConfig: RootConfigService,
  overrides?: Partial<Knex.Config>,
): Promise<Knex.Config> {
  const config = mergeDatabaseConfig(
    dbConfig.get() as Partial<Knex.Config>,
    {
      connection: getPgConnectionConfig(
        dbConfig,
        !!overrides,
      ) as Knex.StaticConnectionConfig,
      useNullAsDefault: true,
    },
    overrides,
  );

  const mergedConfigReader = new ConfigReader(config as JsonObject);

  const connectionConfig = config.connection as Record<string, unknown>;
  if (connectionConfig?.type === 'default' || !connectionConfig?.type) {
    const connectionValue = config.connection;
    const sanitizedConnection =
      typeof connectionValue === 'string' || connectionValue instanceof String
        ? connectionValue
        : omit(connectionValue as Record<string, unknown>, [
            'type',
            'instance',
            'tokenCredential',
          ]);

    return {
      ...config,
      connection: sanitizedConnection,
    } as Knex.Config;
  }

  switch (connectionConfig.type) {
    case 'azure':
      return buildAzurePgConfig(mergedConfigReader);
    case 'cloudsql':
      return buildCloudSqlConfig(mergedConfigReader);
    default:
      throw new Error(`Unknown connection type: ${connectionConfig.type}`);
  }
}

async function buildAzurePgConfig(
  config: RootConfigService,
): Promise<Knex.Config> {
  const {
    DefaultAzureCredential,
    ManagedIdentityCredential,
    ClientSecretCredential,
  } = require('@azure/identity');

  const tokenConfig = config.getOptionalConfig('connection.tokenCredential');
  const tokenRenewableOffsetTime = durationToMilliseconds(
    tokenConfig?.has('tokenRenewableOffsetTime')
      ? readDurationFromConfig(tokenConfig, { key: 'tokenRenewableOffsetTime' })
      : { minutes: 5 },
  );

  const clientId = tokenConfig?.getOptionalString('clientId');
  const tenantId = tokenConfig?.getOptionalString('tenantId');
  const clientSecret = tokenConfig?.getOptionalString('clientSecret');

  let credential: AnyCredential;
  if (clientId && tenantId && clientSecret) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  } else if (clientId) {
    credential = new ManagedIdentityCredential(clientId);
  } else {
    credential = new DefaultAzureCredential();
  }

  const rawConfig = config.get() as Record<string, unknown>;
  const normalized = normalizeConnection(
    rawConfig.connection as string | Record<string, unknown>,
  );
  const sanitizedConnection = omit(normalized, [
    'type',
    'instance',
    'tokenCredential',
  ]);

  async function getConnectionConfig() {
    const token = await credential.getToken(
      'https://ossrdbms-aad.database.windows.net/.default',
    );
    if (!token) {
      throw new Error(
        'Failed to acquire Azure access token for database authentication',
      );
    }
    return {
      ...sanitizedConnection,
      password: token.token,
      expirationChecker: () =>
        token.expiresOnTimestamp - tokenRenewableOffsetTime <= Date.now(),
    };
  }

  return {
    ...rawConfig,
    connection: getConnectionConfig,
  } as Knex.Config;
}

async function buildCloudSqlConfig(
  config: RootConfigService,
): Promise<Knex.Config> {
  const client = config.getOptionalString('client');
  if (client && client !== 'pg') {
    throw new Error('Cloud SQL only supports the pg client');
  }

  const instance = config.getOptionalString('connection.instance');
  if (!instance) {
    throw new Error('Missing instance connection name for Cloud SQL');
  }

  const {
    Connector: CloudSqlConnector,
    IpAddressTypes,
    AuthTypes,
  } = require('@google-cloud/cloud-sql-connector');

  const connector = new CloudSqlConnector();
  const ipTypeRaw = config.getOptionalString('connection.ipAddressType');

  let ipType;
  if (ipTypeRaw !== undefined) {
    if (!Object.values(IpAddressTypes).includes(ipTypeRaw)) {
      throw new Error(
        `Invalid connection.ipAddressType: ${ipTypeRaw}; valid values: ${Object.values(
          IpAddressTypes,
        ).join(', ')}`,
      );
    }
    ipType = ipTypeRaw;
  }

  const clientOpts = await connector.getOptions({
    instanceConnectionName: instance,
    ipType: ipType ?? IpAddressTypes.PUBLIC,
    authType: AuthTypes.IAM,
  });

  const rawConfig = config.get() as Record<string, unknown>;
  const normalized = normalizeConnection(
    rawConfig.connection as string | Record<string, unknown>,
  );
  const sanitizedConnection = omit(normalized, ['type', 'instance']);

  return {
    ...rawConfig,
    client: 'pg',
    connection: {
      ...sanitizedConnection,
      ...clientOpts,
    },
  } as Knex.Config;
}

function getPgConnectionConfig(
  dbConfig: RootConfigService,
  parseConnectionString: boolean,
): unknown {
  const connection = dbConfig.get('connection');
  const isConnectionString =
    typeof connection === 'string' || connection instanceof String;
  const autoParse = typeof parseConnectionString !== 'boolean';
  const shouldParseConnectionString = autoParse
    ? isConnectionString
    : parseConnectionString && isConnectionString;

  return shouldParseConnectionString
    ? parsePgConnectionString(connection as string)
    : connection;
}

function parsePgConnectionString(
  connectionString: string,
): Record<string, unknown> {
  const parse = requirePgConnectionString();
  return parse(connectionString);
}

function requirePgConnectionString(): (s: string) => Record<string, unknown> {
  try {
    return require('pg-connection-string').parse;
  } catch (e) {
    throw new ForwardedError(
      "Postgres: Install 'pg-connection-string'",
      e as Error,
    );
  }
}

async function ensurePgDatabaseExists(
  dbConfig: RootConfigService,
  ...databases: string[]
): Promise<void> {
  const admin = await createPgDatabaseClient(dbConfig, {
    connection: {
      database: 'postgres',
    },
    pool: {
      min: 0,
      acquireTimeoutMillis: 10000,
    },
  });

  try {
    const ensureDatabase = async (database: string) => {
      const result = await admin
        .from('pg_database')
        .where('datname', database)
        .count();
      if (parseInt(result[0].count as string, 10) > 0) {
        return;
      }
      await admin.raw(`CREATE DATABASE ??`, [database]);
    };

    await Promise.all(
      databases.map(async database => {
        let lastErr: Error | undefined = undefined;
        for (let i = 0; i < 3; i++) {
          try {
            return await ddlLimiter(() => ensureDatabase(database));
          } catch (err) {
            lastErr = err as Error;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw lastErr;
      }),
    );
  } finally {
    await admin.destroy();
  }
}

async function ensurePgSchemaExists(
  dbConfig: RootConfigService,
  ...schemas: string[]
): Promise<void> {
  const admin = await createPgDatabaseClient(dbConfig);
  const role = dbConfig.getOptionalString('role');

  try {
    const ensureSchema = async (database: string) => {
      if (role) {
        await admin.raw(`CREATE SCHEMA IF NOT EXISTS ?? AUTHORIZATION ??`, [
          database,
          role,
        ]);
      } else {
        await admin.raw(`CREATE SCHEMA IF NOT EXISTS ??`, [database]);
      }
    };

    await Promise.all(
      schemas.map(database => ddlLimiter(() => ensureSchema(database))),
    );
  } finally {
    await admin.destroy();
  }
}

function pluginPath(pluginId: string): string {
  return `plugin.${pluginId}`;
}

function normalizeConnection(
  connection: string | Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (typeof connection === 'undefined' || connection === null) {
    return {};
  }
  return typeof connection === 'string' || connection instanceof String
    ? parsePgConnectionString(connection as string)
    : connection;
}

interface PgPluginConfig {
  client: string;
  clientOverridden: boolean;
  role: string | undefined;
  additionalKnexConfig: Record<string, unknown> | undefined;
  ensureExists: boolean;
  ensureSchemaExists: boolean;
  pluginDivisionMode: string;
  connection: Record<string, unknown>;
  databaseName: string | undefined;
  databaseClientOverrides: Partial<Knex.Config>;
  knexConfig: Partial<Knex.Config>;
}

function computePgPluginConfig(
  config: RootConfigService,
  pluginId: string,
  prefix: string,
): PgPluginConfig {
  const pluginClient = config.getOptionalString(
    `${pluginPath(pluginId)}.client`,
  );
  const baseClient = config.getString('client');
  const client = pluginClient ?? baseClient;
  const clientOverridden = client !== baseClient;

  const role =
    config.getOptionalString(`${pluginPath(pluginId)}.role`) ??
    config.getOptionalString('role');

  const pluginKnexConfig = config
    .getOptionalConfig(`${pluginPath(pluginId)}.knexConfig`)
    ?.get() as Record<string, unknown> | undefined;
  const baseKnexConfig = config.getOptionalConfig('knexConfig')?.get() as
    | Record<string, unknown>
    | undefined;
  const additionalKnexConfig = merge(
    baseKnexConfig ?? {},
    pluginKnexConfig ?? {},
  ) as Record<string, unknown> | undefined;

  const baseEnsureExists = config.getOptionalBoolean('ensureExists') ?? true;
  const ensureExists =
    config.getOptionalBoolean(`${pluginPath(pluginId)}.ensureExists`) ??
    baseEnsureExists;

  const baseEnsureSchemaExists =
    config.getOptionalBoolean('ensureSchemaExists') ?? false;
  const ensureSchemaExists =
    config.getOptionalBoolean(
      `${pluginPath(pluginId)}.getEnsureSchemaExistsConfig`,
    ) ?? baseEnsureSchemaExists;

  const pluginDivisionMode =
    config.getOptionalString('pluginDivisionMode') ?? 'database';

  let baseConnection = normalizeConnection(
    config.get('connection') as string | Record<string, unknown>,
  );
  if (pluginDivisionMode !== 'schema') {
    baseConnection = omit(baseConnection, 'database');
  }

  const pluginConnection = normalizeConnection(
    config.getOptional(`${pluginPath(pluginId)}.connection`) as
      | string
      | Record<string, unknown>
      | undefined,
  );

  baseConnection.application_name ||= `roadie_plugin_${pluginId}`;

  const connection = {
    ...(clientOverridden ? {} : baseConnection),
    ...pluginConnection,
  };

  const connectionDatabaseName = connection?.database as string | undefined;
  let databaseName: string | undefined;
  if (pluginDivisionMode === 'schema') {
    databaseName = connectionDatabaseName;
  } else {
    databaseName = connectionDatabaseName ?? `${prefix}${pluginId}`;
  }

  let databaseClientOverrides: Partial<Knex.Config> = {};
  if (databaseName) {
    databaseClientOverrides = { connection: { database: databaseName } };
  }

  if (pluginDivisionMode === 'schema') {
    databaseClientOverrides = mergeDatabaseConfig({}, databaseClientOverrides, {
      searchPath: [pluginId],
    } as Partial<Knex.Config>);
  }

  const knexConfig: Partial<Knex.Config> = {
    ...(additionalKnexConfig as Partial<Knex.Config>),
    client,
    connection,
    ...(role && { role }),
  };

  return {
    client,
    clientOverridden,
    role,
    additionalKnexConfig,
    ensureExists,
    ensureSchemaExists,
    pluginDivisionMode,
    connection,
    databaseName,
    databaseClientOverrides,
    knexConfig,
  };
}

export class PgConnector {
  constructor(
    private readonly config: RootConfigService,
    private readonly prefix: string,
  ) {}

  async getClient(pluginId: string, _deps: PluginDeps): Promise<Knex> {
    const pluginDbConfig = computePgPluginConfig(
      this.config,
      pluginId,
      this.prefix,
    );

    if (pluginDbConfig.databaseName && pluginDbConfig.ensureExists) {
      try {
        await ensurePgDatabaseExists(this.config, pluginDbConfig.databaseName);
      } catch (error) {
        throw new Error(
          `Failed to connect to the database to make sure that '${pluginDbConfig.databaseName}' exists, ${error}`,
        );
      }
    }

    if (pluginDbConfig.pluginDivisionMode === 'schema') {
      if (pluginDbConfig.ensureSchemaExists || pluginDbConfig.ensureExists) {
        try {
          await ensurePgSchemaExists(this.config, pluginId);
        } catch (error) {
          throw new Error(
            `Failed to connect to the database to make sure that schema for plugin '${pluginId}' exists, ${error}`,
          );
        }
      }
    }

    const client = createPgDatabaseClient(
      this.config,
      mergeDatabaseConfig(
        pluginDbConfig.knexConfig,
        pluginDbConfig.databaseClientOverrides,
      ),
    );

    return client;
  }
}
