import type { RelationshipSuggestionFieldSemantic } from '@roadiehq/catalog-datastore-common';
import {
  buildFieldProfiles,
  extractStringValues,
  findPathsForValue,
  type FieldProfile,
} from '../schemas/field-profiling';
import { sourceFieldPriority } from '../schemas/field-match-builder';
import {
  classifyRelationshipFieldSemantic,
  semanticCompatibility,
} from '../schemas/semanticFieldClassification';

// Mirrors the old additive scorer's context/classification demotion
// (infrastructure-field-mismatch, context-field-match,
// classification-field-match), corpus-free: a region<->region or
// env<->env pair is structurally identical to an ownerEmail<->email pair
// (both sides identifier-like, same shallow depth) without this, so the
// wizard would rank an environment-constant field above a real reference.
const CONTEXT_DEMOTION_PENALTY = 0.5;

export interface ExamplePatternCandidate {
  sourceFieldExpression: string;
  targetFieldExpression: string;
  matchedValue: string;
  score: number;
}

export interface InferExamplePatternInput {
  sourceObject: unknown;
  targetObject: unknown;
}

function isIdField(path: string): boolean {
  return path === 'id' || path === '$.id' || path === '$.$.id';
}

function hasInstanceQualifier(path: string): boolean {
  return /\[[^\]]*="[^"]*"\]/.test(path);
}

/**
 * A minimal, corpus-free heuristic used only to rank candidate field pairs
 * extracted from a single pasted example object pair (this wizard has no
 * run-scale corpus, so it can't reuse signalScoring's Fellegi-Sunter scorer —
 * that one needs measured u/idf and real value-frequency stats). Higher when
 * either side already looks like an identifier; ties fall back to
 * sourceFieldPriority (shallower field paths win) in the caller's sort.
 */
function localExampleMatchScore(params: {
  sourceProfile?: FieldProfile;
  targetProfile?: FieldProfile;
}): number {
  return (
    (params.sourceProfile?.isIdentifierLike ? 0.5 : 0) +
    (params.targetProfile?.isIdentifierLike ? 0.5 : 0)
  );
}

// 'environment' and 'classification' are the two semantics
// classifyRelationshipFieldSemantic reports for context/constant-shaped
// fields (region/account_id/cluster/env, role/status/type/kind) — the same
// two semanticCompatibility's own 'mismatch' branch keys off of. Demoting on
// either side classifying that way (not just on a source/target mismatch)
// catches the same-domain case a raw compatibility check misses: two
// environment-constant fields (region<->region) are 'same-domain', not
// 'mismatch', but are exactly the noise pattern this demotion exists for.
function isContextIshSemantic(
  semantic: RelationshipSuggestionFieldSemantic,
): boolean {
  return semantic === 'environment' || semantic === 'classification';
}

function semanticRankPenalty(sourceField: string, targetField: string): number {
  const sourceSemantic = classifyRelationshipFieldSemantic(sourceField);
  const targetSemantic = classifyRelationshipFieldSemantic(targetField);
  const compatibility = semanticCompatibility(sourceSemantic, targetSemantic);
  return compatibility === 'mismatch' ||
    isContextIshSemantic(sourceSemantic) ||
    isContextIshSemantic(targetSemantic)
    ? CONTEXT_DEMOTION_PENALTY
    : 0;
}

export function inferExampleRelationshipPattern({
  sourceObject,
  targetObject,
}: InferExamplePatternInput): ExamplePatternCandidate[] {
  const sourceValuesByField: Record<string, Record<string, number>> = {};
  extractStringValues(sourceObject, '$', sourceValuesByField);

  const sourceProfiles = buildFieldProfiles([sourceObject]).profilesByField;
  const targetProfiles = buildFieldProfiles([targetObject]).profilesByField;
  const candidatesByPair = new Map<string, ExamplePatternCandidate>();

  for (const [sourceFieldExpression, values] of Object.entries(
    sourceValuesByField,
  )) {
    for (const matchedValue of Object.keys(values)) {
      const targetPaths = findPathsForValue(targetObject, matchedValue);
      for (const targetFieldExpression of targetPaths) {
        if (
          isIdField(sourceFieldExpression) &&
          isIdField(targetFieldExpression)
        ) {
          continue;
        }

        if (
          hasInstanceQualifier(sourceFieldExpression) ||
          hasInstanceQualifier(targetFieldExpression)
        ) {
          continue;
        }

        const localScore = localExampleMatchScore({
          sourceProfile: sourceProfiles[sourceFieldExpression],
          targetProfile: targetProfiles[targetFieldExpression],
        });
        const score =
          localScore -
          semanticRankPenalty(sourceFieldExpression, targetFieldExpression) -
          sourceFieldPriority(sourceFieldExpression) / 100 -
          sourceFieldPriority(targetFieldExpression) / 1000;
        const key = `${sourceFieldExpression}|${targetFieldExpression}`;
        const existing = candidatesByPair.get(key);
        if (!existing || score > existing.score) {
          candidatesByPair.set(key, {
            sourceFieldExpression,
            targetFieldExpression,
            matchedValue,
            score,
          });
        }
      }
    }
  }

  return [...candidatesByPair.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const sourcePriority =
      sourceFieldPriority(a.sourceFieldExpression) -
      sourceFieldPriority(b.sourceFieldExpression);
    if (sourcePriority !== 0) {
      return sourcePriority;
    }
    return (
      sourceFieldPriority(a.targetFieldExpression) -
      sourceFieldPriority(b.targetFieldExpression)
    );
  });
}
