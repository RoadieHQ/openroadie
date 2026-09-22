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
  Annotation,
  ContextGroupRule,
  ContextGroupRuleInput,
  DatasourceFilter,
} from '@roadiehq/catalog-datastore-common';
import type { WorkflowDatastoreBridgeApi } from '../services/WorkflowDatastoreBridge';

const { getContextGroupSeeds } = require('../../seeds/context-groups') as {
  getContextGroupSeeds: () => ContextGroupSeed[];
};

export { getContextGroupSeeds };

export interface ContextGroupSeedDefinition {
  name: string;
  slug: string;
  description: string;
  seedNames: string[];
  mergeRelationshipTypes?: string[];
  /** Optional rule-level instructions for AI agents consuming the bundle. */
  annotations?: Annotation[];
}

export interface ContextGroupSeed extends ContextGroupSeedDefinition {
  version: number;
  previousVersions?: ContextGroupSeedDefinition[];
}

export interface SeedContextGroupsDeps {
  seedWorkflowIds: Map<string, string>;
  client: Pick<
    WorkflowDatastoreBridgeApi,
    | 'createContextGroupRule'
    | 'listContextGroupRules'
    | 'updateContextGroupRule'
  >;
  logger: LoggerService;
  /** Subset of seed definitions to apply; defaults to all getContextGroupSeeds(). */
  seeds?: ContextGroupSeed[];
  workspaceId: string;
}

export interface SeedContextGroupsResult {
  created: number;
  updated: number;
  skipped: number;
  unresolved: number;
}

export async function fetchAllRules(
  client: SeedContextGroupsDeps['client'],
  workspaceId: string,
): Promise<ContextGroupRule[]> {
  const pageSize = 1000;
  const all: ContextGroupRule[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.listContextGroupRules(
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

function candidate(
  seedName: string,
  seedWorkflowIds: Map<string, string>,
): DatasourceFilter {
  const datasourceId = seedWorkflowIds.get(seedName);
  return {
    seedName,
    ...(datasourceId ? { datasourceId } : {}),
  };
}

function countUnresolved(
  seedNames: string[],
  seedWorkflowIds: Map<string, string>,
): number {
  return seedNames.filter(seedName => !seedWorkflowIds.has(seedName)).length;
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

function inputForSeed(
  seed: ContextGroupSeed,
  seedWorkflowIds: Map<string, string>,
): ContextGroupRuleInput {
  return {
    name: seed.name,
    slug: seed.slug,
    description: seed.description,
    datasources: seed.seedNames.map(seedName =>
      candidate(seedName, seedWorkflowIds),
    ),
    mergeRelationshipTypes: seed.mergeRelationshipTypes ?? [],
    ...(seed.annotations ? { annotations: seed.annotations } : {}),
    seedVersion: seed.version,
  };
}

function matchesDefinition(
  rule: ContextGroupRule,
  definition: ContextGroupSeedDefinition,
  seedWorkflowIds: Map<string, string>,
): boolean {
  const matchesCandidates = (
    candidates: DatasourceFilter[],
    seedNames: string[],
  ) =>
    candidates.length === seedNames.length &&
    candidates.every((candidateValue, index) => {
      const seedName = seedNames[index];
      const expectedDatasourceId = seedWorkflowIds.get(seedName);
      return (
        candidateValue.seedName === seedName &&
        (candidateValue.datasourceId === undefined ||
          candidateValue.datasourceId === expectedDatasourceId) &&
        candidateValue.filter === undefined &&
        candidateValue.projection === undefined &&
        candidateValue.annotation === undefined
      );
    });

  return (
    rule.name === definition.name &&
    rule.slug === definition.slug &&
    rule.description === definition.description &&
    matchesCandidates(rule.datasources, definition.seedNames) &&
    JSON.stringify(rule.mergeRelationshipTypes) ===
      JSON.stringify(definition.mergeRelationshipTypes ?? []) &&
    JSON.stringify(rule.annotations) ===
      JSON.stringify(definition.annotations ?? []) &&
    rule.includeExternalRelations
  );
}

function canUpdateSeededRule(
  rule: ContextGroupRule,
  seed: ContextGroupSeed,
  seedWorkflowIds: Map<string, string>,
): boolean {
  if (rule.seedVersion !== null) {
    return rule.seedVersion < seed.version;
  }
  return (seed.previousVersions ?? []).some(previous =>
    matchesDefinition(rule, previous, seedWorkflowIds),
  );
}

export async function seedContextGroups(
  deps: SeedContextGroupsDeps,
): Promise<SeedContextGroupsResult> {
  const { seedWorkflowIds, client, workspaceId } = deps;
  const contextGroupSeeds = deps.seeds ?? getContextGroupSeeds();
  const existingRules = await fetchAllRules(client, workspaceId);
  const existingBySlug = new Map(existingRules.map(rule => [rule.slug, rule]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let unresolved = 0;

  for (const seed of contextGroupSeeds) {
    unresolved += countUnresolved(seed.seedNames, seedWorkflowIds);

    const input = inputForSeed(seed, seedWorkflowIds);
    const existing = existingBySlug.get(seed.slug);
    if (existing) {
      if (canUpdateSeededRule(existing, seed, seedWorkflowIds)) {
        const rule = await client.updateContextGroupRule(
          existing.id,
          input,
          workspaceId,
        );
        existingBySlug.set(rule.slug, rule);
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    try {
      const rule = await client.createContextGroupRule(input, workspaceId);
      existingBySlug.set(rule.slug, rule);
      created += 1;
    } catch (error) {
      if (!isConflictError(error)) {
        throw error;
      }
      skipped += 1;
    }
  }

  return { created, updated, skipped, unresolved };
}
