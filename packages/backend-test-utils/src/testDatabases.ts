/*
 * Copyright 2025 Larder Software Ltd.
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
 */

import { Knex, knex } from 'knex';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { v4 as uuid } from 'uuid';
import type { TestDatabaseId } from './types';

async function createPostgresContainer(
  postgresVersion: string,
): Promise<StartedPostgreSqlContainer> {
  const container = new PostgreSqlContainer(`postgres:${postgresVersion}`)
    .withDatabase('test')
    .withUsername('test')
    .withPassword('test');
  try {
    return await container.start();
  } catch (e: unknown) {
    // testcontainers hardcodes a 10s port-bind inspect timeout (not covered
    // by withStartupTimeout) that lapses when the full suite starts many
    // containers at once; one retry absorbs the contention instead of
    // flaking the whole file.
    if (e instanceof Error && /waiting for container ports/.test(e.message)) {
      return container.start();
    }
    throw e;
  }
}

interface DatabaseEngine {
  createDatabase(): Promise<Knex>;
  shutdown(): Promise<void>;
}

interface PostgresConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function getSharedPostgresConnection(): PostgresConnectionConfig | undefined {
  const host = process.env.TEST_POSTGRES_HOST;
  if (!host) {
    return undefined;
  }

  const port = Number(process.env.TEST_POSTGRES_PORT ?? 5432);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `Invalid TEST_POSTGRES_PORT: ${process.env.TEST_POSTGRES_PORT}`,
    );
  }

  return {
    host,
    port,
    user: process.env.TEST_POSTGRES_USER ?? 'postgres',
    password: process.env.TEST_POSTGRES_PASSWORD ?? '',
    database: process.env.TEST_POSTGRES_DATABASE ?? 'postgres',
  };
}

class SqliteEngine implements DatabaseEngine {
  private connections: Knex[] = [];

  async createDatabase(): Promise<Knex> {
    const connection = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    this.connections.push(connection);
    return connection;
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.connections.map(c => c.destroy()));
    this.connections = [];
  }
}

class PostgresEngine implements DatabaseEngine {
  private container: StartedPostgreSqlContainer | undefined;
  private connections: Knex[] = [];
  private postgresVersion: string;
  private sharedConnection: PostgresConnectionConfig | undefined;

  constructor(postgresVersion: string) {
    this.postgresVersion = postgresVersion;
    this.sharedConnection = getSharedPostgresConnection();
  }

  private async getAdminConnectionConfig(): Promise<PostgresConnectionConfig> {
    if (this.sharedConnection) {
      return this.sharedConnection;
    }

    if (!this.container) {
      this.container = await createPostgresContainer(this.postgresVersion);
    }

    const container = this.container;
    return {
      host: container.getHost(),
      port: container.getPort(),
      user: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
    };
  }

  async createDatabase(): Promise<Knex> {
    const adminConnectionConfig = await this.getAdminConnectionConfig();
    const dbName = `test_${uuid().replace(/-/g, '')}`;

    // `pg` mutates the `password` field of the connection object it is handed
    // (it wraps it after the first SASL handshake), so a config object shared
    // across knex instances leaves the next connection with a non-string
    // password and fails with "client password must be a string". Give every
    // connection its own fresh copy.
    const adminConnection = knex({
      client: 'pg',
      connection: { ...adminConnectionConfig },
    });

    try {
      await adminConnection.raw(`CREATE DATABASE "${dbName}"`);
    } finally {
      await adminConnection.destroy();
    }

    const connection = knex({
      client: 'pg',
      connection: {
        ...adminConnectionConfig,
        database: dbName,
      },
    });

    this.connections.push(connection);
    return connection;
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.connections.map(c => c.destroy()));
    this.connections = [];
    if (this.container) {
      await this.container.stop();
      this.container = undefined;
    }
  }
}

function getPostgresVersion(id: TestDatabaseId): string {
  const match = id.match(/POSTGRES_(\d+)/);
  if (match) {
    return match[1];
  }
  throw new Error(`Invalid postgres database ID: ${id}`);
}

/**
 * Encapsulates the creation of ephemeral test database instances for use
 * inside unit or integration tests.
 *
 * @public
 */
export class TestDatabases {
  private readonly engines: Map<TestDatabaseId, DatabaseEngine> = new Map();
  private readonly supportedIds: TestDatabaseId[];
  private static defaultIds?: TestDatabaseId[];

  /**
   * Creates an empty `TestDatabases` instance, and sets up the test framework
   * to clean up all of its acquired resources after all tests finish.
   *
   * You typically want to create just a single instance like this at the top
   * of your test file or `describe` block, and then call `init` many times on
   * that instance inside the individual tests. Spinning up a "physical"
   * database instance takes a considerable amount of time, slowing down tests.
   * But initializing a new logical database inside that instance using `init`
   * is very fast.
   */
  static create(options?: {
    ids?: TestDatabaseId[];
    disableDocker?: boolean;
  }): TestDatabases {
    const ids =
      options?.ids ?? TestDatabases.defaultIds ?? (['POSTGRES_16'] as const);
    const instance = new TestDatabases(ids, options?.disableDocker ?? false);

    if (typeof afterAll !== 'undefined') {
      afterAll(async () => {
        await instance.shutdown();
      });
    }

    return instance;
  }

  /**
   * Sets default database IDs to use when creating instances.
   */
  static setDefaults(options: { ids?: TestDatabaseId[] }): void {
    TestDatabases.defaultIds = options.ids;
  }

  private constructor(
    supportedIds: readonly TestDatabaseId[],
    private readonly disableDocker: boolean,
  ) {
    this.supportedIds = [...supportedIds];
  }

  /**
   * Check if a particular database ID is supported in this instance.
   */
  supports(id: TestDatabaseId): boolean {
    if (this.disableDocker && id !== 'SQLITE_3') {
      return false;
    }
    return this.supportedIds.includes(id);
  }

  /**
   * Returns an array of supported database IDs, suitable for use with
   * `it.each()` or `describe.each()`.
   */
  eachSupportedId(): [TestDatabaseId][] {
    return this.supportedIds
      .filter(id => !this.disableDocker || id === 'SQLITE_3')
      .map(id => [id]);
  }

  /**
   * Returns a fresh, unique, empty logical database on an instance of the
   * given database ID platform.
   *
   * @param id - The ID of the database platform to use, e.g. 'POSTGRES_16'
   * @returns A `Knex` connection object
   */
  async init(id: TestDatabaseId): Promise<Knex> {
    if (!this.supports(id)) {
      throw new Error(
        `Database ${id} is not supported. Supported: ${this.supportedIds.join(', ')}`,
      );
    }

    let engine = this.engines.get(id);
    if (!engine) {
      engine = this.createEngine(id);
      this.engines.set(id, engine);
    }

    return engine.createDatabase();
  }

  private createEngine(id: TestDatabaseId): DatabaseEngine {
    if (id === 'SQLITE_3') {
      return new SqliteEngine();
    }

    if (id.startsWith('POSTGRES_')) {
      const version = getPostgresVersion(id);
      return new PostgresEngine(version);
    }

    throw new Error(`Unknown database ID: ${id}`);
  }

  private async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.engines.values()).map(engine =>
      engine.shutdown(),
    );
    await Promise.all(shutdownPromises);
    this.engines.clear();
  }
}
