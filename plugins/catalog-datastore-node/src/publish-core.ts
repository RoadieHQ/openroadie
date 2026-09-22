/*
 * Copyright 2026 Larder Software Ltd.
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

import type { Knex } from 'knex';
import type { JsonValue } from '@roadiehq/types';
import {
  getShape,
  computeSchemaHash,
  generateSchemaDescription,
} from '@roadiehq/catalog-datastore-common';

export interface PublishSourceRelation {
  sql: string;
  bindings: readonly Knex.RawBinding[];
}

export interface PublishDelta {
  deleted: number;
  updated: number;
  inserted: number;
}

const DATASTORE_TABLE = 'datastore';
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export async function diffMergePublish(
  trx: Knex.Transaction,
  options: {
    datasourceId: string;
    workspaceId?: string;
    source: PublishSourceRelation;
    schemaId: string | null;
  },
): Promise<PublishDelta> {
  const { datasourceId, source, schemaId } = options;
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;

  await trx.raw(
    `CREATE TEMP TABLE publish_delta (
       datastore_id uuid NOT NULL,
       kind text NOT NULL
     ) ON COMMIT DROP`,
  );

  const deleteResult = await trx.raw(
    `
    DELETE FROM ${DATASTORE_TABLE} d
    WHERE d.datasource_id = ? AND d.workspace_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM (${source.sql}) s WHERE s.object_id = d.object_id
      )
    `,
    [datasourceId, workspaceId, ...source.bindings],
  );

  await trx.raw(
    `
    WITH changed AS (
      UPDATE ${DATASTORE_TABLE} d
      SET object = s.object,
          object_hash = s.object_hash,
          schema_id = COALESCE(?::uuid, d.schema_id),
          updated_at = now()
      FROM (${source.sql}) s
      WHERE d.datasource_id = ? AND d.workspace_id = ?
        AND d.object_id = s.object_id
        AND s.object_hash IS DISTINCT FROM d.object_hash
      RETURNING d.id
    )
    INSERT INTO publish_delta (datastore_id, kind)
    SELECT id, 'updated' FROM changed
    `,
    [schemaId, ...source.bindings, datasourceId, workspaceId],
  );

  await trx.raw(
    `
    WITH added AS (
      INSERT INTO ${DATASTORE_TABLE}
        (id, workspace_id, datasource_id, object_id, object, object_hash, schema_id,
         created_at, updated_at)
      SELECT gen_random_uuid(), ?, ?, s.object_id, s.object, s.object_hash,
             ?::uuid, now(), now()
      FROM (${source.sql}) s
      WHERE NOT EXISTS (
        SELECT 1 FROM ${DATASTORE_TABLE} d
        WHERE d.datasource_id = ? AND d.workspace_id = ?
          AND d.object_id = s.object_id
      )
      RETURNING id
    )
    INSERT INTO publish_delta (datastore_id, kind)
    SELECT id, 'inserted' FROM added
    `,
    [
      workspaceId,
      datasourceId,
      schemaId,
      ...source.bindings,
      datasourceId,
      workspaceId,
    ],
  );

  const [{ count: updated }] = (
    await trx.raw(
      `SELECT count(*) AS count FROM publish_delta WHERE kind = 'updated'`,
    )
  ).rows as Array<{ count: string }>;
  const [{ count: inserted }] = (
    await trx.raw(
      `SELECT count(*) AS count FROM publish_delta WHERE kind = 'inserted'`,
    )
  ).rows as Array<{ count: string }>;

  return {
    deleted: deleteResult.rowCount ?? 0,
    updated: Number(updated),
    inserted: Number(inserted),
  };
}

export async function restampUnchangedSchemaIds(
  trx: Knex.Transaction,
  options: {
    datasourceId: string;
    workspaceId?: string;
    schemaId: string;
  },
): Promise<void> {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  await trx.raw(
    `
    UPDATE ${DATASTORE_TABLE}
    SET schema_id = ?
    WHERE datasource_id = ? AND workspace_id = ?
      AND schema_id IS DISTINCT FROM ?
    `,
    [options.schemaId, options.datasourceId, workspaceId, options.schemaId],
  );
}

const SCHEMA_TABLE = 'datastore_schema';

export async function upsertSchemaVersion(
  db: Knex,
  options: {
    datasourceId: string;
    workspaceId?: string;
    datasourceName: string;
    sampleObjects: JsonValue[];
    explicitSchema?: JsonValue;
  },
): Promise<string> {
  const shape: JsonValue =
    options.explicitSchema ?? getShape(options.sampleObjects);
  const contentHash = computeSchemaHash(shape);
  const description = generateSchemaDescription(options.datasourceName, shape);
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;

  const latest = (
    await db.raw(
      `
      SELECT id, version, content_hash, description
      FROM ${SCHEMA_TABLE}
      WHERE datasource_id = ? AND workspace_id = ?
      ORDER BY version DESC
      LIMIT 1
      `,
      [options.datasourceId, workspaceId],
    )
  ).rows[0] as
    | { id: string; version: number; content_hash: string; description: string }
    | undefined;

  if (latest?.content_hash === contentHash) {
    if (latest.description !== description) {
      await db.raw(`UPDATE ${SCHEMA_TABLE} SET description = ? WHERE id = ?`, [
        description,
        latest.id,
      ]);
    }
    return latest.id;
  }

  const inserted = (
    await db.raw(
      `
      INSERT INTO ${SCHEMA_TABLE}
        (id, workspace_id, datasource_id, version, description, schema, content_hash, created_at)
      VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, now())
      RETURNING id
      `,
      [
        workspaceId,
        options.datasourceId,
        latest ? latest.version + 1 : 1,
        description,
        JSON.stringify(shape),
        contentHash,
      ],
    )
  ).rows[0] as { id: string };
  return inserted.id;
}
