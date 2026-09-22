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
import type { IntegrationBackedConfig, RelationshipRule } from './types';

/** `null` and `undefined` are the same "no filter" — normalize so a rule with
 *  no filters still pairs with its true mirror. */
function normalizeOptional(value: string | null | undefined): string | null {
  return value ?? null;
}

/**
 * `JSON.stringify` serializes object keys in insertion order, so two configs
 * that differ only in how they were built would digest differently and their
 * rules would never pair. Sort keys at every depth so the digest depends on the
 * config's content alone.
 *
 * Array order is preserved rather than sorted: it is not knowably meaningless,
 * and the conservative failure here is refusing to pair (a redundant mirror
 * survives) rather than pairing two rules that differ (a distinct rule is
 * permanently suppressed).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Absent and explicitly-null configs are the same "not integration-backed". */
function integrationConfigDigest(
  config: IntegrationBackedConfig | null | undefined,
): string {
  return config ? JSON.stringify(canonicalize(config)) : '';
}

/** JSON rather than a joined string: a field expression may itself contain the
 *  separator, which would let two different rules collide on one key. */
function inverseKey(parts: {
  sourceDatasourceId: string;
  sourceFieldExpression: string;
  sourceFilterExpression: string | null | undefined;
  targetDatasourceId: string;
  targetFieldExpression: string;
  targetFilterExpression: string | null | undefined;
  matchStrategy: RelationshipRule['matchStrategy'] | undefined;
  strategy: RelationshipRule['strategy'] | undefined;
  integrationConfig?: IntegrationBackedConfig | null;
}): string {
  return JSON.stringify([
    parts.sourceDatasourceId,
    parts.sourceFieldExpression,
    normalizeOptional(parts.sourceFilterExpression),
    parts.targetDatasourceId,
    parts.targetFieldExpression,
    normalizeOptional(parts.targetFilterExpression),
    parts.matchStrategy ?? 'exact',
    parts.strategy ?? 'field-matching',
    integrationConfigDigest(parts.integrationConfig),
  ]);
}

/**
 * Map of `ruleId → inverseRule` for rules whose (sourceField, targetField) is
 * the literal swap of another rule's — the rule going A→B on X→Y paired with
 * the one going B→A on Y→X. Approving one side of such a pair makes the other
 * side redundant: both materialize the same edge.
 *
 * The key also carries `strategy`, `matchStrategy`, a canonical digest of
 * `integrationConfig`, and both filter expressions (swapped with their sides on
 * the reverse lookup): two rules over the same field pair but a different
 * strategy, integration, filter or match strategy select different objects, so
 * they are not the same edge — an integration-backed rule resolves its target
 * through a live API call and only coincidentally shares the field expressions
 * of a field-matching one. Since suppression is permanent, pairing them would
 * destroy a genuinely distinct rule. `relationshipType` is deliberately NOT in
 * the key: the two directions of one edge normally name it differently.
 */
export function buildInverseMap(
  rules: RelationshipRule[],
): Map<string, RelationshipRule> {
  const byKey = new Map<string, RelationshipRule>();
  for (const rule of rules) {
    byKey.set(inverseKey(rule), rule);
  }
  const inverseByRuleId = new Map<string, RelationshipRule>();
  for (const rule of rules) {
    const reverseKey = inverseKey({
      sourceDatasourceId: rule.targetDatasourceId,
      sourceFieldExpression: rule.targetFieldExpression,
      sourceFilterExpression: rule.targetFilterExpression,
      targetDatasourceId: rule.sourceDatasourceId,
      targetFieldExpression: rule.sourceFieldExpression,
      targetFilterExpression: rule.sourceFilterExpression,
      matchStrategy: rule.matchStrategy,
      strategy: rule.strategy,
      integrationConfig: rule.integrationConfig,
    });
    const inverse = byKey.get(reverseKey);
    if (inverse && inverse.id !== rule.id) {
      inverseByRuleId.set(rule.id, inverse);
    }
  }
  return inverseByRuleId;
}

/**
 * EVERY candidate whose content is the inverse of `rule` (the B→A of an A→B),
 * not just one. `buildInverseMap` keeps a single inverse per content key (last
 * write wins), which can hide a still-`active` or still-`suggested` mirror
 * behind an inactive duplicate of the same pair. A caller that must react to
 * the mirror's STATE — the mirror-pair approval lock — needs all of them so it
 * can pick the most-blocking one rather than whichever row happened to sort
 * last. Excludes `rule` itself.
 */
export function findInverses(
  rule: RelationshipRule,
  candidates: RelationshipRule[],
): RelationshipRule[] {
  const reverseKey = inverseKey({
    sourceDatasourceId: rule.targetDatasourceId,
    sourceFieldExpression: rule.targetFieldExpression,
    sourceFilterExpression: rule.targetFilterExpression,
    targetDatasourceId: rule.sourceDatasourceId,
    targetFieldExpression: rule.sourceFieldExpression,
    targetFilterExpression: rule.sourceFilterExpression,
    matchStrategy: rule.matchStrategy,
    strategy: rule.strategy,
    integrationConfig: rule.integrationConfig,
  });
  return candidates.filter(
    candidate =>
      candidate.id !== rule.id && inverseKey(candidate) === reverseKey,
  );
}

function scoreForComparison(score: number | null | undefined): number {
  return typeof score === 'number' ? score : -Infinity;
}

/** Higher score wins; an id comparison breaks ties so the result is stable. */
export function ruleWinsInverse(
  rule: RelationshipRule,
  inverse: RelationshipRule,
): boolean {
  const ruleScore = scoreForComparison(rule.score);
  const inverseScore = scoreForComparison(inverse.score);
  if (ruleScore !== inverseScore) {
    return ruleScore > inverseScore;
  }
  return rule.id <= inverse.id;
}

/**
 * Split an approve request into the ids to approve and the mirrored ids to
 * dismiss. A mirror that was not itself requested is still dismissed — the
 * caller chose a direction, so the other one is noise.
 */
export function splitSuggestedRuleBulkApprove(
  rules: RelationshipRule[],
  ruleIds: string[],
): { approveIds: string[]; dismissInverseIds: string[] } {
  const requested = new Set(ruleIds);
  const ruleById = new Map(rules.map(r => [r.id, r]));
  const inverseByRuleId = buildInverseMap(rules);
  const approveIds: string[] = [];
  const dismissInverseIds = new Set<string>();
  const droppedFromApprove = new Set<string>();

  for (const id of ruleIds) {
    if (droppedFromApprove.has(id) || dismissInverseIds.has(id)) continue;
    const rule = ruleById.get(id);
    const inverse = inverseByRuleId.get(id);
    const inverseInRequest = inverse ? requested.has(inverse.id) : false;

    if (!rule || !inverse) {
      approveIds.push(id);
      continue;
    }

    if (ruleWinsInverse(rule, inverse)) {
      approveIds.push(id);
      if (inverseInRequest) {
        droppedFromApprove.add(inverse.id);
      }
      dismissInverseIds.add(inverse.id);
    } else if (inverseInRequest) {
      // The mirror wins and is also in the request — let it win on its own
      // iteration rather than approving both.
      droppedFromApprove.add(id);
    } else {
      // The mirror scores higher but the caller did not ask for it. Naming a
      // direction explicitly suppresses its mirror unconditionally: leaving it
      // `suggested` would let a later `approve --all` materialize the same edge
      // from the other side. Score arbitration only decides between two
      // directions the caller requested both of.
      approveIds.push(id);
      dismissInverseIds.add(inverse.id);
    }
  }

  return {
    approveIds: approveIds.filter(id => !droppedFromApprove.has(id)),
    dismissInverseIds: [...dismissInverseIds].filter(
      id => !requested.has(id) || droppedFromApprove.has(id),
    ),
  };
}
