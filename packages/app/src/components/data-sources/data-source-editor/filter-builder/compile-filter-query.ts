import {
  defaultRuleProcessorJSONata,
  formatQuery,
  type Field,
  type RuleGroupType,
  type RuleType,
  type ValueProcessorOptions,
} from 'react-querybuilder';

const BOOLEAN_LITERALS = new Set(['true', 'false']);

function isGroup(rule: RuleGroupType['rules'][number]): rule is RuleGroupType {
  return typeof rule === 'object' && rule !== null && 'rules' in rule;
}

/**
 * sc-34595: a rule's value is typed into a plain text box whenever the field's
 * type isn't known yet (no dry-run sample), so "true" is stored as a string
 * and compiled to `field = "true"` — a string comparison that silently matches
 * nothing against boolean data, while the builder renders the same rule as a
 * boolean switch once the sample arrives. Coerce at compile time: an `=`/`!=`
 * against 'true'/'false' becomes a real boolean comparison unless the dry-run
 * sample says the field genuinely holds strings. (Numbers already get this via
 * formatQuery's `parseNumbers`.)
 */
function coerceBooleanRule(
  rule: RuleType,
  fieldsByName: Map<string, Field>,
): RuleType {
  if (rule.operator !== '=' && rule.operator !== '!=') {
    return rule;
  }
  if (typeof rule.value !== 'string') {
    return rule;
  }
  const literal = rule.value.trim().toLowerCase();
  if (!BOOLEAN_LITERALS.has(literal)) {
    return rule;
  }
  const field = fieldsByName.get(rule.field);
  const isBooleanField = field?.valueEditorType === 'checkbox';
  const isUnknownField = field === undefined;
  if (!isBooleanField && !isUnknownField) {
    return rule;
  }
  return { ...rule, value: literal === 'true' };
}

function coerceGroup(
  group: RuleGroupType,
  fieldsByName: Map<string, Field>,
): RuleGroupType {
  return {
    ...group,
    rules: group.rules.map(rule =>
      isGroup(rule)
        ? coerceGroup(rule, fieldsByName)
        : coerceBooleanRule(rule, fieldsByName),
    ),
  };
}

/**
 * The default JSONata emission for is-empty is `field = null`, which never
 * matches a *missing* field — JSONata comparisons against an absent value
 * yield nothing, so "is empty" silently skipped items that simply lack the
 * key. Emit an explicit existence check instead. The default emission is
 * still used to render the field path, so quoting stays the library's job.
 */
function emptyAwareRuleProcessor(
  rule: RuleType,
  options?: ValueProcessorOptions,
): string {
  const base = defaultRuleProcessorJSONata(rule, options);
  if (rule.operator === 'null') {
    const path = base.replace(/ = null$/, '');
    return `($not($exists(${path})) or ${path} = null)`;
  }
  if (rule.operator === 'notNull') {
    const path = base.replace(/ != null$/, '');
    return `($exists(${path}) and ${path} != null)`;
  }
  return base;
}

/**
 * Inverse of {@link emptyAwareRuleProcessor}: collapse the existence-check
 * patterns back to the plain `= null` / `!= null` forms that parseJSONata
 * understands, so an expression we compiled still hydrates into the builder.
 * Run this over an expression before handing it to parseJSONata.
 */
export function normalizeEmptyChecks(expression: string): string {
  return expression
    .replace(/\(\$not\(\$exists\((.+?)\)\) or \1 = null\)/g, '$1 = null')
    .replace(/\(\$exists\((.+?)\) and \1 != null\)/g, '$1 != null');
}

export function compileFilterQuery(
  query: RuleGroupType,
  fields: Field[] = [],
): string {
  if (!query.rules || query.rules.length === 0) {
    return '';
  }
  const fieldsByName = new Map(fields.map(f => [f.name, f]));
  const result = formatQuery(coerceGroup(query, fieldsByName), {
    format: 'jsonata',
    parseNumbers: true,
    ruleProcessor: emptyAwareRuleProcessor,
  });
  return typeof result === 'string' ? result : '';
}
