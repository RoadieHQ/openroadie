import { useMemo } from 'react';
import { flattenSchemaFields, type SchemaField } from './schema-field-utils';
import {
  FieldExpressionPicker,
  fieldOptionsFromPaths,
} from './field-expression-picker';

interface FieldColumnProps {
  heading: string;
  accessibleLabel: string;
  /** Data-source name shown above the heading. Omit where the surrounding
   * layout already names the source (e.g. the stepped editor's section header). */
  entityLabel?: string;
  fields: SchemaField[];
  value: string;
  onChange: (value: string) => void;
}

export function FieldColumn({
  heading,
  accessibleLabel,
  entityLabel,
  fields,
  value,
  onChange,
}: FieldColumnProps) {
  const selectableFields = useMemo(() => flattenSchemaFields(fields), [fields]);
  const hasFields = selectableFields.length > 0;
  const options = useMemo(
    () =>
      fieldOptionsFromPaths(
        selectableFields.map(f => ({ path: f.path, type: f.type })),
      ),
    [selectableFields],
  );

  return (
    <FieldExpressionPicker
      heading={heading}
      accessibleLabel={accessibleLabel}
      entityLabel={entityLabel}
      value={value}
      onChange={onChange}
      options={options}
      fieldDisabled={!hasFields}
      expressionPlaceholder="e.g. $.spec.owner"
      fieldNote={
        !hasFields && (
          <div className="text-xs text-muted-foreground">
            No known fields — pick from the schema or switch to an expression.
          </div>
        )
      }
    />
  );
}
