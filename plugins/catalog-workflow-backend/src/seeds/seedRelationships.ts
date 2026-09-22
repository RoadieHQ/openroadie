/*
 * Copyright 2026 Larder Software Limited
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

import type { LoggerService } from '@roadiehq/extensions-api';
import { ResponseError } from '@roadiehq/errors';
import type {
  CatalogDatastoreApi,
  RelationshipRule,
  RelationshipRuleInput,
  RelationshipRuleMatchStrategy,
} from '@roadiehq/catalog-datastore-common';

const { getRelationshipSeeds } = require('../../seeds/relationships') as {
  getRelationshipSeeds: () => RelationshipSeed[];
};

export interface RelationshipSeed {
  name: string;
  description: string;
  sourceSeedName: string;
  targetSeedName: string;
  strategy: 'field-matching';
  matchStrategy: RelationshipRuleMatchStrategy;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  relationshipType: string;
  reciprocalRelationshipType?: string;
}

export interface SeedRelationshipsDeps {
  seedWorkflowIds: Map<string, string>;
  client: {
    createRelationshipRule(
      input: RelationshipRuleInput,
      workspaceId: string,
    ): Promise<RelationshipRule>;
    listRelationshipRules(
      options: Parameters<CatalogDatastoreApi['listRelationshipRules']>[0],
      workspaceId: string,
    ): ReturnType<CatalogDatastoreApi['listRelationshipRules']>;
  };
  workspaceId: string;
  logger: LoggerService;
}

export interface SeedRelationshipsResult {
  created: number;
  skipped: number;
}

function isSameRule(
  rule: RelationshipRule,
  input: RelationshipRuleInput,
): boolean {
  return (
    rule.sourceDatasourceId === input.sourceDatasourceId &&
    rule.targetDatasourceId === input.targetDatasourceId &&
    rule.sourceFieldExpression === input.sourceFieldExpression &&
    rule.targetFieldExpression === input.targetFieldExpression &&
    rule.relationshipType === input.relationshipType &&
    (rule.reciprocalRelationshipType ?? undefined) ===
      (input.reciprocalRelationshipType ?? undefined)
  );
}

async function fetchAllRules(
  client: SeedRelationshipsDeps['client'],
  workspaceId: string,
): Promise<RelationshipRule[]> {
  const pageSize = 1000;
  const all: RelationshipRule[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.listRelationshipRules(
      {
        limit: pageSize,
        offset,
      },
      workspaceId,
    );
    all.push(...page.items);
    if (page.items.length === 0 || all.length >= page.total) {
      return all;
    }
  }
}

function isConflictError(error: unknown): boolean {
  return (
    (error instanceof ResponseError && error.statusCode === 409) ||
    (error instanceof Error &&
      /already exists|duplicate key value violates unique constraint/i.test(
        error.message,
      ))
  );
}

export async function seedRelationships(
  deps: SeedRelationshipsDeps,
): Promise<SeedRelationshipsResult> {
  const { seedWorkflowIds, client, logger, workspaceId } = deps;
  const relationshipSeeds = getRelationshipSeeds();
  const existingRules = await fetchAllRules(client, workspaceId);

  let created = 0;
  let skipped = 0;

  for (const seed of relationshipSeeds) {
    const sourceDatasourceId = seedWorkflowIds.get(seed.sourceSeedName);
    const targetDatasourceId = seedWorkflowIds.get(seed.targetSeedName);

    if (!sourceDatasourceId || !targetDatasourceId) {
      skipped += 1;
      logger.info(
        `[seed-relationships] skipping "${seed.name}": missing ` +
          `${!sourceDatasourceId ? seed.sourceSeedName : seed.targetSeedName}`,
      );
      continue;
    }

    const input: RelationshipRuleInput = {
      name: seed.name,
      description: seed.description,
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression: seed.sourceFieldExpression,
      targetFieldExpression: seed.targetFieldExpression,
      relationshipType: seed.relationshipType,
      reciprocalRelationshipType: seed.reciprocalRelationshipType,
      strategy: seed.strategy,
      matchStrategy: seed.matchStrategy,
      origin: 'seed',
    };

    if (existingRules.some(rule => isSameRule(rule, input))) {
      skipped += 1;
      continue;
    }

    try {
      const rule = await client.createRelationshipRule(
        {
          ...input,
          state: 'active',
        },
        workspaceId,
      );
      existingRules.push(rule);
      created += 1;
    } catch (error) {
      if (!isConflictError(error)) {
        throw error;
      }
      skipped += 1;
    }
  }

  return { created, skipped };
}
