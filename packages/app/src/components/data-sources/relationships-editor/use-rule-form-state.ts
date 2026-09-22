import { useCallback, useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';
import type {
  IntegrationBackedConfig,
  RelationshipRule,
  RelationshipRuleInput,
  RelationshipRuleMatchStrategy,
  RelationshipRuleStrategy,
} from '../../../api/datastore/datastore-client';
import { useZodForm } from '../../common';
import {
  relationshipJoinExprFromGraphPath,
  type SchemaField,
} from './schema-field-utils';
import { deriveReciprocal } from './relationship-type';
import { useRelationshipTypeField } from './use-relationship-type-field';

const RULE_STRATEGIES = [
  'field-matching',
  'integration-backed',
] as const satisfies readonly RelationshipRuleStrategy[];
const MATCH_STRATEGIES = [
  'exact',
  'contains',
  'array_contains',
  'regex',
  'person_name_alias',
] as const satisfies readonly RelationshipRuleMatchStrategy[];

// Structural only: the editor has no per-field validation messages — saving is
// gated by the duplicate checks and preview freshness instead — so the schema
// just types the value store.
const ruleFormSchema = z.object({
  sourceFieldExpression: z.string(),
  targetFieldExpression: z.string(),
  strategy: z.enum(RULE_STRATEGIES),
  integrationConfig: z.custom<IntegrationBackedConfig>().nullable(),
  sourceFilterExpression: z.string(),
  targetFilterExpression: z.string(),
  matchStrategy: z.enum(MATCH_STRATEGIES),
});

export type RuleFormValues = z.infer<typeof ruleFormSchema>;

const NEW_RULE_VALUES: RuleFormValues = {
  sourceFieldExpression: '',
  targetFieldExpression: '',
  strategy: 'field-matching',
  integrationConfig: null,
  sourceFilterExpression: '',
  targetFilterExpression: '',
  matchStrategy: 'exact',
};

function valuesFromRule(rule: RelationshipRule): RuleFormValues {
  return {
    sourceFieldExpression: rule.sourceFieldExpression,
    targetFieldExpression: rule.targetFieldExpression,
    strategy: rule.strategy ?? 'field-matching',
    integrationConfig: rule.integrationConfig ?? null,
    sourceFilterExpression: rule.sourceFilterExpression ?? '',
    targetFilterExpression: rule.targetFilterExpression ?? '',
    matchStrategy: rule.matchStrategy,
  };
}

function normalizeFilterExpression(value: string | null | undefined): string {
  return (value ?? '').trim();
}

// Canonical form for comparing/serializing integration configs. Rules loaded
// from the API round-trip through a jsonb column that rewrites key order, so
// raw JSON.stringify equality never holds between an editor-built config and a
// stored one; a fixed field list (with optional fields defaulted) makes the
// duplicate and dirty checks order- and default-insensitive.
function normalizeIntegrationConfig(
  config: IntegrationBackedConfig | null | undefined,
): Record<string, unknown> | null {
  if (!config) {
    return null;
  }
  return {
    integrationId: config.integrationId,
    method: (config.method ?? 'GET').trim().toUpperCase(),
    path: config.path,
    pathExpression: config.pathExpression ?? null,
    sourceContext: config.sourceContext
      ? {
          maxDepth: config.sourceContext.maxDepth ?? null,
          relationshipTypes: config.sourceContext.relationshipTypes ?? null,
          datasourceIds: config.sourceContext.datasourceIds ?? null,
        }
      : null,
    responseMatchExpression: config.responseMatchExpression,
    metadataExpression: config.metadataExpression ?? null,
  };
}

function integrationConfigsEqual(
  a: IntegrationBackedConfig | null | undefined,
  b: IntegrationBackedConfig | null | undefined,
): boolean {
  return (
    JSON.stringify(normalizeIntegrationConfig(a)) ===
    JSON.stringify(normalizeIntegrationConfig(b))
  );
}

// Single serialized identity for the rule's editable inputs. The preview
// freshness key and the dirty check both derive from this one builder, so a
// new rule input only has to be added in one place.
function ruleSignature(fields: {
  strategy: RelationshipRuleStrategy;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  sourceFilterExpression: string;
  targetFilterExpression: string;
  relationshipType: string;
  reciprocalRelationshipType: string;
  matchStrategy: RelationshipRuleMatchStrategy;
  integrationConfig: IntegrationBackedConfig | null;
}): string {
  return JSON.stringify({
    strategy: fields.strategy,
    sourceFieldExpression: fields.sourceFieldExpression.trim(),
    targetFieldExpression: fields.targetFieldExpression.trim(),
    sourceFilterExpression: fields.sourceFilterExpression.trim(),
    targetFilterExpression: fields.targetFilterExpression.trim(),
    relationshipType: fields.relationshipType.trim(),
    reciprocalRelationshipType: fields.reciprocalRelationshipType.trim(),
    matchStrategy: fields.matchStrategy,
    integrationConfig:
      fields.strategy === 'integration-backed'
        ? normalizeIntegrationConfig(fields.integrationConfig)
        : null,
  });
}

function ruleMatchesEditorSignature(
  rule: RelationshipRule,
  {
    excludeRuleId,
    strategy,
    sourceDatasourceId,
    targetDatasourceId,
    sourceFieldExpression,
    targetFieldExpression,
    relationshipType,
    sourceFilterExpression,
    targetFilterExpression,
    matchStrategy,
    integrationConfig,
  }: {
    excludeRuleId?: string;
    strategy: RelationshipRuleStrategy;
    sourceDatasourceId: string;
    targetDatasourceId: string;
    sourceFieldExpression: string;
    targetFieldExpression: string;
    relationshipType: string;
    sourceFilterExpression: string;
    targetFilterExpression: string;
    matchStrategy: RelationshipRuleMatchStrategy;
    integrationConfig: IntegrationBackedConfig | null;
  },
): boolean {
  if (rule.id === excludeRuleId) {
    return false;
  }
  if ((rule.strategy ?? 'field-matching') !== strategy) {
    return false;
  }
  if (
    rule.sourceDatasourceId !== sourceDatasourceId ||
    rule.targetDatasourceId !== targetDatasourceId ||
    rule.sourceFieldExpression !== sourceFieldExpression ||
    rule.targetFieldExpression !== targetFieldExpression ||
    rule.relationshipType !== relationshipType
  ) {
    return false;
  }
  if (
    normalizeFilterExpression(rule.sourceFilterExpression) !==
      sourceFilterExpression ||
    normalizeFilterExpression(rule.targetFilterExpression) !==
      targetFilterExpression
  ) {
    return false;
  }
  if (
    strategy === 'integration-backed' &&
    !integrationConfigsEqual(rule.integrationConfig, integrationConfig)
  ) {
    return false;
  }
  if (
    strategy === 'field-matching' &&
    (rule.matchStrategy ?? 'exact') !== matchStrategy
  ) {
    return false;
  }
  return true;
}

function resolveInitialFieldExpression(
  fields: SchemaField[],
  initialField: string | undefined,
): string {
  if (!initialField) {
    return '';
  }
  if (initialField.trim().startsWith('$')) {
    return initialField;
  }
  return (
    relationshipJoinExprFromGraphPath(fields, initialField) ??
    `$.${initialField}`
  );
}

export interface UseRuleFormStateOptions {
  open: boolean;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  existingRule?: RelationshipRule;
  existingRules?: RelationshipRule[];
  initialSourceField?: string;
  initialTargetField?: string;
}

/**
 * The rule editor's value store: the editable rule fields on a `useZodForm`
 * form (plus the type/reciprocal verbs on the field hook shared with the
 * manual single-edge editor), session-keyed seeding, the serialized rule
 * signature with its dirty check, and the duplicate checks against the
 * existing rules.
 */
export function useRuleFormState({
  open,
  sourceDatasourceId,
  targetDatasourceId,
  sourceFields,
  targetFields,
  existingRule,
  existingRules,
  initialSourceField,
  initialTargetField,
}: UseRuleFormStateOptions) {
  const form = useZodForm({
    schema: ruleFormSchema,
    defaultValues: NEW_RULE_VALUES,
  });
  const {
    sourceFieldExpression,
    targetFieldExpression,
    strategy,
    integrationConfig,
    sourceFilterExpression,
    targetFilterExpression,
    matchStrategy,
  } = form.watch();

  // The type + reciprocal verbs live in the field hook shared with the manual
  // single-edge editor, so auto-derivation/override behavior stays identical.
  const existingTypeNames = useMemo(
    () => (existingRules ?? []).map(r => r.relationshipType),
    [existingRules],
  );
  const {
    relationshipType,
    reciprocalRelationshipType,
    handleRelationshipTypeChange,
    handleReciprocalChange,
    relationshipTypeOptions,
    reset: resetTypeField,
  } = useRelationshipTypeField({ existingTypes: existingTypeNames });

  // Seed the form once per editing session, keyed on what's being edited: the
  // rule id, or a new-rule slot keyed on the datasource pair + initial fields
  // (replacing one pending connection with another must reseed). The latest
  // seed inputs live in a ref so the effect re-runs only when the session
  // identity changes — a background schemas/rules refetch that hands us new
  // array/object references with unchanged content must not wipe in-progress
  // edits.
  const seedKey = open
    ? (existingRule?.id ??
      `new:${sourceDatasourceId}|${targetDatasourceId}|${initialSourceField}|${initialTargetField}`)
    : null;
  const seedInputsRef = useRef({
    existingRule,
    sourceFields,
    targetFields,
    initialSourceField,
    initialTargetField,
  });
  seedInputsRef.current = {
    existingRule,
    sourceFields,
    targetFields,
    initialSourceField,
    initialTargetField,
  };
  useEffect(() => {
    if (seedKey === null) {
      return;
    }
    const seed = seedInputsRef.current;
    if (seed.existingRule) {
      form.reset(valuesFromRule(seed.existingRule));
      const derived = deriveReciprocal(seed.existingRule.relationshipType);
      // A known type always uses the derived reverse verb (the field is hidden
      // for it), so ignore any stale non-standard reverse stored against it
      // rather than carrying an invisible value the UI can't show.
      resetTypeField({
        type: seed.existingRule.relationshipType,
        reciprocal:
          derived !== ''
            ? derived
            : (seed.existingRule.reciprocalRelationshipType ?? ''),
      });
    } else {
      form.reset({
        ...NEW_RULE_VALUES,
        sourceFieldExpression: resolveInitialFieldExpression(
          seed.sourceFields,
          seed.initialSourceField,
        ),
        targetFieldExpression: resolveInitialFieldExpression(
          seed.targetFields,
          seed.initialTargetField,
        ),
      });
      resetTypeField();
    }
  }, [seedKey, form, resetTypeField]);

  const setSourceFieldExpression = useCallback(
    (value: string) => form.setValue('sourceFieldExpression', value),
    [form],
  );
  const setTargetFieldExpression = useCallback(
    (value: string) => form.setValue('targetFieldExpression', value),
    [form],
  );
  const setStrategy = useCallback(
    (value: RelationshipRuleStrategy) => form.setValue('strategy', value),
    [form],
  );
  const setIntegrationConfig = useCallback(
    (value: IntegrationBackedConfig | null) =>
      form.setValue('integrationConfig', value),
    [form],
  );
  const setSourceFilterExpression = useCallback(
    (value: string) => form.setValue('sourceFilterExpression', value),
    [form],
  );
  const setTargetFilterExpression = useCallback(
    (value: string) => form.setValue('targetFilterExpression', value),
    [form],
  );
  const setMatchStrategy = useCallback(
    (value: RelationshipRuleMatchStrategy) =>
      form.setValue('matchStrategy', value),
    [form],
  );

  const isIntegrationBacked = strategy === 'integration-backed';

  // Serialized identity of the rule's editable inputs — shared by the preview
  // freshness key and the dirty check.
  const currentSignature = useMemo(
    () =>
      ruleSignature({
        strategy,
        sourceFieldExpression,
        targetFieldExpression,
        sourceFilterExpression,
        targetFilterExpression,
        relationshipType,
        reciprocalRelationshipType,
        matchStrategy,
        integrationConfig,
      }),
    [
      strategy,
      sourceFieldExpression,
      targetFieldExpression,
      sourceFilterExpression,
      targetFilterExpression,
      relationshipType,
      reciprocalRelationshipType,
      matchStrategy,
      integrationConfig,
    ],
  );

  // Whether the current inputs differ from the rule being edited. Creating a
  // new rule is always "dirty"; inspecting an existing rule without touching it
  // is not — so the "run a preview" hint stays hidden until something changes.
  // (RHF's own isDirty is unused on purpose: the signature applies the same
  // trimming + jsonb-key-order normalization the preview freshness key needs,
  // so there is exactly one definition of "changed".)
  const existingSignature = useMemo(() => {
    if (!existingRule) {
      return null;
    }
    // Seed state normalizes the reverse verb to the derived value for a type
    // with a known inverse, so the baseline signature must apply the same
    // normalization — otherwise a rule with a null/non-standard stored reverse
    // reads as dirty the moment it's opened, with no user edit.
    const derived = deriveReciprocal(existingRule.relationshipType);
    return ruleSignature({
      strategy: existingRule.strategy ?? 'field-matching',
      sourceFieldExpression: existingRule.sourceFieldExpression,
      targetFieldExpression: existingRule.targetFieldExpression,
      sourceFilterExpression: existingRule.sourceFilterExpression ?? '',
      targetFilterExpression: existingRule.targetFilterExpression ?? '',
      relationshipType: existingRule.relationshipType,
      reciprocalRelationshipType:
        derived !== ''
          ? derived
          : (existingRule.reciprocalRelationshipType ?? ''),
      matchStrategy: existingRule.matchStrategy,
      integrationConfig: existingRule.integrationConfig ?? null,
    });
  }, [existingRule]);
  const isDirty =
    existingSignature === null || currentSignature !== existingSignature;

  // One duplicate check for both directions: the reciprocal duplicate is the
  // same signature with the sides swapped and the reciprocal type substituted.
  const matchesExistingRule = useCallback(
    (candidate: {
      sourceDatasourceId: string;
      targetDatasourceId: string;
      sourceFieldExpression: string;
      targetFieldExpression: string;
      relationshipType: string;
      sourceFilterExpression: string;
      targetFilterExpression: string;
    }) => {
      if (!existingRules) {
        return false;
      }
      if (
        !candidate.sourceFieldExpression ||
        !candidate.targetFieldExpression ||
        !candidate.relationshipType
      ) {
        return false;
      }
      return existingRules.some(r =>
        ruleMatchesEditorSignature(r, {
          excludeRuleId: existingRule?.id,
          strategy,
          matchStrategy,
          integrationConfig,
          ...candidate,
        }),
      );
    },
    [existingRules, existingRule, strategy, matchStrategy, integrationConfig],
  );

  const isDuplicate = useMemo(
    () =>
      matchesExistingRule({
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: sourceFieldExpression.trim(),
        targetFieldExpression: targetFieldExpression.trim(),
        relationshipType: relationshipType.trim(),
        sourceFilterExpression: sourceFilterExpression.trim(),
        targetFilterExpression: targetFilterExpression.trim(),
      }),
    [
      matchesExistingRule,
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression,
      targetFieldExpression,
      relationshipType,
      sourceFilterExpression,
      targetFilterExpression,
    ],
  );

  const isReciprocalDuplicate = useMemo(
    () =>
      matchesExistingRule({
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: targetFieldExpression.trim(),
        targetFieldExpression: sourceFieldExpression.trim(),
        relationshipType: reciprocalRelationshipType.trim(),
        sourceFilterExpression: targetFilterExpression.trim(),
        targetFilterExpression: sourceFilterExpression.trim(),
      }),
    [
      matchesExistingRule,
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression,
      targetFieldExpression,
      reciprocalRelationshipType,
      sourceFilterExpression,
      targetFilterExpression,
    ],
  );

  const buildRuleInput = useCallback((): RelationshipRuleInput => {
    const src = sourceFieldExpression.trim();
    const tgt = targetFieldExpression.trim();
    return {
      name: `${src} → ${tgt}`,
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression: src,
      targetFieldExpression: tgt,
      sourceFilterExpression: sourceFilterExpression.trim() || undefined,
      targetFilterExpression: targetFilterExpression.trim() || undefined,
      relationshipType: relationshipType.trim(),
      reciprocalRelationshipType:
        reciprocalRelationshipType.trim() || undefined,
      strategy,
      matchStrategy,
      integrationConfig: isIntegrationBacked ? integrationConfig : undefined,
      origin: 'manual',
    };
  }, [
    sourceDatasourceId,
    targetDatasourceId,
    sourceFieldExpression,
    targetFieldExpression,
    sourceFilterExpression,
    targetFilterExpression,
    relationshipType,
    reciprocalRelationshipType,
    strategy,
    matchStrategy,
    integrationConfig,
    isIntegrationBacked,
  ]);

  return {
    form,
    sourceFieldExpression,
    setSourceFieldExpression,
    targetFieldExpression,
    setTargetFieldExpression,
    strategy,
    setStrategy,
    isIntegrationBacked,
    integrationConfig,
    setIntegrationConfig,
    sourceFilterExpression,
    setSourceFilterExpression,
    targetFilterExpression,
    setTargetFilterExpression,
    matchStrategy,
    setMatchStrategy,
    relationshipType,
    reciprocalRelationshipType,
    handleRelationshipTypeChange,
    handleReciprocalChange,
    relationshipTypeOptions,
    currentSignature,
    isDirty,
    isDuplicate,
    isReciprocalDuplicate,
    buildRuleInput,
  };
}
