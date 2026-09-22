import type { LoggerService } from '@roadiehq/extensions-api';
import type { RelationshipRule } from './types';

/**
 * Order rules so a context-aware integration-backed rule (one with
 * `sourceContext`) runs after the rules that produce the edges it traverses.
 *
 * Dependencies come in two strengths. A rule that names its consumed types
 * (`sourceContext.relationshipTypes`) has a hard dependency on their
 * producers. A rule that omits them may follow any edge, so it prefers to
 * wait for every other rule — but that preference is only a heuristic, and
 * mutually unsatisfiable as soon as two such rules exist.
 *
 * The sort is a stable topological order (original order among independent
 * rules). When it stalls, soft dependencies are relaxed one rule at a time —
 * hard ones are never violated — and a warning names the rules whose relative
 * order is therefore arbitrary. Only a hard producer/consumer cycle falls
 * back to the original order.
 */
export function orderRulesByGraphDependencies(
  rules: RelationshipRule[],
  logger?: LoggerService,
): RelationshipRule[] {
  const producersByType = new Map<string, Set<number>>();
  rules.forEach((rule, index) => {
    for (const type of [
      rule.relationshipType,
      rule.reciprocalRelationshipType,
    ]) {
      if (!type) continue;
      const producers = producersByType.get(type) ?? new Set<number>();
      producers.add(index);
      producersByType.set(type, producers);
    }
  });

  const nodes = rules.map((rule, index) => {
    const hardDeps = new Set<number>();
    const softDeps = new Set<number>();
    const sourceContext =
      rule.strategy === 'integration-backed'
        ? rule.integrationConfig?.sourceContext
        : undefined;
    const consumedTypes = sourceContext?.relationshipTypes;
    if (sourceContext && (!consumedTypes || consumedTypes.length === 0)) {
      for (let producer = 0; producer < rules.length; producer++) {
        if (producer !== index) softDeps.add(producer);
      }
    } else {
      for (const type of consumedTypes ?? []) {
        for (const producer of producersByType.get(type) ?? []) {
          if (producer !== index) hardDeps.add(producer);
        }
      }
    }
    return { rule, index, hardDeps, softDeps };
  });

  const ordered: RelationshipRule[] = [];
  const done = new Set<number>();
  const isDone = (dep: number) => done.has(dep);
  const softRelaxed: string[] = [];
  const hardCycle: string[] = [];

  while (ordered.length < nodes.length) {
    let progress = false;
    for (const node of nodes) {
      if (done.has(node.index)) continue;
      if (
        [...node.hardDeps].every(isDone) &&
        [...node.softDeps].every(isDone)
      ) {
        ordered.push(node.rule);
        done.add(node.index);
        progress = true;
      }
    }
    if (progress) {
      continue;
    }

    // Stall: release the first rule whose hard deps are met, ignoring its
    // soft ones, then resume strict ordering so downstream hard dependencies
    // are still honored.
    const relaxable = nodes.find(
      node => !done.has(node.index) && [...node.hardDeps].every(isDone),
    );
    if (relaxable) {
      ordered.push(relaxable.rule);
      done.add(relaxable.index);
      softRelaxed.push(relaxable.rule.name);
      continue;
    }

    // Hard producer/consumer cycle — no correct order exists; append as-is.
    for (const node of nodes) {
      if (!done.has(node.index)) {
        ordered.push(node.rule);
        done.add(node.index);
        hardCycle.push(node.rule.name);
      }
    }
  }

  if (softRelaxed.length > 0) {
    logger?.warn(
      `Relationship rules [${softRelaxed.join(', ')}] traverse arbitrary edge types, so their apply order relative to other context-aware rules is arbitrary — set sourceContext.relationshipTypes to make it deterministic`,
    );
  }
  if (hardCycle.length > 0) {
    logger?.warn(
      `Relationship rules [${hardCycle.join(', ')}] form a dependency cycle through their consumed relationship types; applying them in their original order`,
    );
  }
  return ordered;
}
