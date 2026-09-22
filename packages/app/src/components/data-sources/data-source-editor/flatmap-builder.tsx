import { useCallback } from 'react';
import { Switch } from '@roadiehq/ui/switch';
import { FLATMAP_PARENT_KEY } from '../../../api/workflow/workflow-client';
import { JsonataFieldSelect } from './jsonata-field-select';

const isArrayValue = (value: unknown) => Array.isArray(value);

export interface FlatmapBuilderProps {
  config: Record<string, unknown>;
  /** Items produced by the previous step, used to list array-valued fields. */
  inputSample?: unknown[];
  onChange: (field: string, value: unknown) => void;
  testId?: string;
}

export function FlatmapBuilder({
  config,
  inputSample,
  onChange,
  testId,
}: FlatmapBuilderProps) {
  const expression =
    typeof config.expression === 'string' ? config.expression : '';
  const includeParent = config.includeParent === true;
  const hasSample = Array.isArray(inputSample) && inputSample.length > 0;

  const handleExpressionChange = useCallback(
    (e: { target: { value: string } }) =>
      onChange('expression', e.target.value),
    [onChange],
  );

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={testId ?? 'flatmap-builder'}
    >
      <JsonataFieldSelect
        data={inputSample}
        value={expression}
        label="Array field"
        onChange={handleExpressionChange}
        valid={isArrayValue}
        outputType="array"
        // Two items can legitimately hold the same array (an empty one, most
        // often), and a field the whole point of expanding must not drop out
        // of the list because of it.
        allowDuplicateSampleValues
        includeRoot={false}
        helperText={
          hasSample
            ? 'Each element of this array becomes its own item.'
            : 'Dry run the data source to list array fields, or switch to advanced mode to write the expression.'
        }
      />

      <label className="flex items-start gap-3 text-xs text-muted-foreground">
        <Switch
          checked={includeParent}
          onCheckedChange={checked =>
            onChange('includeParent', checked === true)
          }
        />
        <span>
          Keep the item each element came from under{' '}
          <code className="text-xs">{FLATMAP_PARENT_KEY}</code>.
        </span>
      </label>
    </div>
  );
}
