import React, { useCallback, useMemo } from 'react';
import {
  QueryBuilder,
  type Field,
  type RuleGroupType,
} from 'react-querybuilder';
import { parseJSONata } from 'react-querybuilder/parseJSONata';
import { Switch } from '@roadiehq/ui/switch';
import { JsonataExpressionField } from '../jsonata-expression-field';
import { deriveFields } from '../derive-fields';
import {
  AdvancedConfirmBanner,
  useAdvancedModeState,
} from '../../../common/advanced-mode-state';
import type { JsonataAssistServiceLike } from '../jsonata-assist-types';
import {
  roadieControlClassnames,
  roadieControlElements,
} from './rqb-control-elements';
import {
  compileFilterQuery,
  normalizeEmptyChecks,
} from './compile-filter-query';

export interface FilterBuilderProps {
  filter?: RuleGroupType;
  expression?: string;
  inputSample?: unknown;
  onChange: (filter: RuleGroupType | undefined, expression: string) => void;
  jsonataAssist?: JsonataAssistServiceLike;
  testId?: string;
}

const EMPTY_GROUP: RuleGroupType = { combinator: 'and', rules: [] };

function tryParse(expression: string): RuleGroupType | null {
  try {
    const parsed = parseJSONata(normalizeEmptyChecks(expression));
    if (parsed && typeof parsed === 'object' && 'rules' in parsed) {
      const group = parsed as RuleGroupType;
      if (group.rules.length > 0) {
        return group;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function FilterBuilder({
  filter,
  expression,
  inputSample,
  onChange,
  jsonataAssist,
  testId,
}: FilterBuilderProps) {
  const truncatedSample = useMemo(
    () => (Array.isArray(inputSample) ? inputSample.slice(0, 10) : undefined),
    [inputSample],
  );

  const fields = useMemo<Field[]>(
    () => (truncatedSample ? deriveFields(truncatedSample) : []),
    [truncatedSample],
  );

  const compile = useCallback(
    (query: RuleGroupType) => compileFilterQuery(query, fields),
    [fields],
  );

  const adv = useAdvancedModeState<RuleGroupType>({
    initialStructured: filter,
    initialExpression: expression,
    emptyStructured: EMPTY_GROUP,
    parse: tryParse,
    compile,
    onChange,
  });

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={testId ?? 'filter-builder'}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Filter</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Advanced (JSONata)</span>
          <Switch
            checked={adv.advancedMode}
            onCheckedChange={adv.toggleAdvanced}
            aria-label="Advanced mode"
          />
        </div>
      </div>

      {adv.confirmOpen && (
        <AdvancedConfirmBanner
          onConfirm={adv.confirmExitAdvanced}
          onCancel={adv.cancelExitAdvanced}
          testId="filter-builder-confirm"
        />
      )}

      {adv.advancedMode ? (
        <JsonataExpressionField
          value={adv.expression}
          onChange={adv.setAdvancedExpression}
          label="Filter Expression"
          placeholder='kind = "Component"'
          helperText="JSONata expression → boolean"
          transformType="filter"
          inputSample={truncatedSample}
          jsonataAssist={jsonataAssist}
          testId="jsonata-textarea"
        />
      ) : (
        <div data-testid="filter-builder-querybuilder">
          <QueryBuilder
            fields={fields}
            query={adv.structured}
            onQueryChange={adv.setStructured}
            controlElements={roadieControlElements}
            controlClassnames={roadieControlClassnames}
            resetOnFieldChange
          />
        </div>
      )}
    </div>
  );
}
