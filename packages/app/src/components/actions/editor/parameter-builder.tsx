import { useMemo, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Switch } from '@roadiehq/ui/switch';
import { Label } from '@roadiehq/ui/label';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { SelectItem } from '@roadiehq/ui/select';
import type { ActionParam, ParamType } from '../types';

/** Monotonic render keys — param names are user-editable, so they can't key the list. */
let keyCounter = 0;
const nextKey = () => `k${keyCounter++}`;

const PARAM_TYPES: { value: ParamType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'array<string>', label: 'Array of strings' },
];

/** Render a stored default value back into the text input for editing. */
function defaultToText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Coerce raw text input into the typed default; empty → undefined (unset). */
function parseDefault(type: ParamType, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  switch (type) {
    case 'number':
    case 'integer': {
      const n = Number(trimmed);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'array<string>':
      return raw
        .split(',')
        .map(s => s.trim())
        .filter(s => s !== '');
    default:
      return raw;
  }
}

export function ParameterBuilder({
  value,
  onChange,
  disabled,
}: {
  value: ActionParam[];
  onChange: (next: ActionParam[]) => void;
  disabled?: boolean;
}) {
  // Stable render keys parallel to `value`; handlers keep them aligned across
  // add/remove. A length mismatch means the parent replaced the list — reseed.
  const paramKeysRef = useRef<string[]>([]);
  if (paramKeysRef.current.length !== value.length) {
    paramKeysRef.current = value.map(nextKey);
  }
  const paramKeys = paramKeysRef.current;

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of value) {
      if (p.name) {
        counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
      }
    }
    return new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name),
    );
  }, [value]);

  const update = (index: number, patch: Partial<ActionParam>) => {
    onChange(value.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const remove = (index: number) => {
    paramKeysRef.current = paramKeys.filter((_, i) => i !== index);
    onChange(value.filter((_, i) => i !== index));
  };

  const add = () => {
    paramKeysRef.current = [...paramKeys, nextKey()];
    onChange([...value, { name: '', type: 'string', required: false }]);
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No parameters. Add one to template it into the request with{' '}
          <code className="font-mono">{'{{name}}'}</code>.
        </p>
      )}

      {value.map((param, index) => {
        const nameError =
          param.name.trim() === ''
            ? 'Name is required'
            : duplicateNames.has(param.name)
              ? 'Duplicate parameter name'
              : undefined;

        return (
          <div
            key={paramKeys[Number(index)]}
            className="flex flex-col gap-3 rounded-md border border-border p-3"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <OutlinedInput
                  label="Name"
                  value={param.name}
                  disabled={disabled}
                  onChange={e => update(index, { name: e.target.value })}
                  className={nameError ? 'border-destructive' : undefined}
                />
                {nameError && (
                  <p className="mt-1 text-xs text-destructive">{nameError}</p>
                )}
              </div>
              <div className="w-48">
                <OutlinedSelect
                  label="Type"
                  value={param.type}
                  disabled={disabled}
                  onValueChange={v => update(index, { type: v as ParamType })}
                >
                  {PARAM_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </OutlinedSelect>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Switch
                  id={`required-${index}`}
                  checked={!!param.required}
                  disabled={disabled}
                  onCheckedChange={checked =>
                    // A required param can't also have a default — clear it.
                    update(
                      index,
                      checked
                        ? { required: true, default: undefined }
                        : { required: false },
                    )
                  }
                />
                <Label htmlFor={`required-${index}`} className="text-xs">
                  Required
                </Label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                disabled={disabled}
                onClick={() => remove(index)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <OutlinedInput
              label="Description (optional)"
              value={param.description ?? ''}
              disabled={disabled}
              onChange={e =>
                update(index, { description: e.target.value || undefined })
              }
            />
            {!param.required &&
              (param.type === 'boolean' ? (
                <div className="flex items-center gap-2">
                  <Switch
                    id={`default-${index}`}
                    checked={param.default === true}
                    disabled={disabled}
                    onCheckedChange={checked =>
                      update(index, { default: checked })
                    }
                  />
                  <Label htmlFor={`default-${index}`} className="text-xs">
                    Default value
                  </Label>
                </div>
              ) : (
                <OutlinedInput
                  label={
                    param.type === 'array<string>'
                      ? 'Default value (optional, comma-separated)'
                      : 'Default value (optional)'
                  }
                  value={defaultToText(param.default)}
                  disabled={disabled}
                  onChange={e =>
                    update(index, {
                      default: parseDefault(param.type, e.target.value),
                    })
                  }
                />
              ))}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={add}
      >
        <Plus className="size-4" />
        Add parameter
      </Button>
    </div>
  );
}
