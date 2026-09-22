import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowRight, Braces, Check, Plus, Trash2, X } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import { Switch } from '@roadiehq/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { cn } from '@roadiehq/ui/utils';
import { JsonataExpressionField } from '../jsonata-expression-field';
import { deriveFields } from '../derive-fields';
import { FieldPicker } from '../../../common/field-picker';
import {
  AdvancedConfirmBanner,
  useAdvancedModeState,
} from '../../../common/advanced-mode-state';
import type { JsonataAssistServiceLike } from '../jsonata-assist-types';
import { compileMap } from './compile-map';
import { parseMapRules } from './parse-map';
import {
  nextOverrideId,
  type MapOverride,
  type MapOverrideSource,
  type MapRules,
} from './types';

export interface MapBuilderProps {
  rules?: MapRules;
  expression?: string;
  inputSample?: unknown;
  onChange: (rules: MapRules | undefined, expression: string) => void;
  jsonataAssist?: JsonataAssistServiceLike;
  testId?: string;
}

const EMPTY_RULES: MapRules = { passthrough: true, overrides: [] };

function defaultLiteralSource(): MapOverrideSource {
  return { kind: 'literal', valueType: 'string', value: '' };
}

function changeSourceKind(
  prev: MapOverrideSource,
  nextKind: MapOverrideSource['kind'],
): MapOverrideSource {
  if (prev.kind === nextKind) {
    return prev;
  }
  if (nextKind === 'literal') {
    return defaultLiteralSource();
  }
  if (nextKind === 'field') {
    return { kind: 'field', path: '' };
  }
  return { kind: 'expression', expression: '' };
}

function changeLiteralType(
  prev: MapOverrideSource,
  valueType: 'string' | 'number' | 'boolean' | 'null',
): MapOverrideSource {
  if (prev.kind !== 'literal') {
    return prev;
  }
  switch (valueType) {
    case 'string':
      return { kind: 'literal', valueType, value: '' };
    case 'number':
      return { kind: 'literal', valueType, value: 0 };
    case 'boolean':
      return { kind: 'literal', valueType, value: false };
    case 'null':
      return { kind: 'literal', valueType, value: null };
    default:
      return prev;
  }
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function ExpressionEditor({
  value,
  fields,
  onChange,
  testId,
}: {
  value: string;
  fields: ReadonlyArray<{ name: string; label?: string }>;
  onChange: (next: string) => void;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handlePick = (path: string) => {
    const input = inputRef.current;
    const live = input?.value ?? value;
    if (!input) {
      onChange(live + path);
      return;
    }
    const start = input.selectionStart ?? live.length;
    const end = input.selectionEnd ?? live.length;
    const next = live.slice(0, start) + path + live.slice(end);
    setNativeInputValue(input, next);
    requestAnimationFrame(() => {
      input.focus();
      const cursor = start + path.length;
      input.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="flex min-w-[10rem] grow basis-[10rem] items-center gap-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="$count(items)"
        className="h-8 grow font-mono text-xs"
        aria-label="JSONata expression"
        data-testid={testId}
      />
      {fields.length > 0 && (
        <FieldPicker
          fields={fields}
          onPick={handlePick}
          triggerLabel="Insert field"
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Insert field"
              data-testid={testId ? `${testId}-insert-field` : undefined}
              className="motion-transform size-7 shrink-0 text-muted-foreground hover:text-foreground active:scale-[0.96]"
            >
              <Braces className="size-3.5" />
            </Button>
          }
        />
      )}
    </div>
  );
}

function OverrideRow({
  override,
  fields,
  onChange,
  onRemove,
}: {
  override: MapOverride;
  fields: ReadonlyArray<{ name: string; label?: string }>;
  onChange: (next: MapOverride) => void;
  onRemove: () => void;
}) {
  const setTargetPath = (path: string) =>
    onChange({ ...override, targetPath: path });

  const setKind = (kind: MapOverrideSource['kind']) =>
    onChange({ ...override, source: changeSourceKind(override.source, kind) });

  const setLiteralType = (
    valueType: 'string' | 'number' | 'boolean' | 'null',
  ) =>
    onChange({
      ...override,
      source: changeLiteralType(override.source, valueType),
    });

  const setSourceValue = (next: MapOverrideSource) =>
    onChange({ ...override, source: next });

  return (
    <li
      data-testid={`map-row-${override.id}`}
      className="flex flex-row flex-wrap items-center gap-1.5 rounded-md bg-background/50 px-1.5 py-1"
    >
      <Select
        value={override.source.kind}
        onValueChange={v => setKind(v as MapOverrideSource['kind'])}
      >
        <SelectTrigger
          className="h-8 w-[5.5rem] shrink-0 px-2 text-xs"
          aria-label="Source kind"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="literal">Literal</SelectItem>
          <SelectItem value="field">Field</SelectItem>
          <SelectItem value="expression">Expression</SelectItem>
        </SelectContent>
      </Select>

      {override.source.kind === 'literal' && (
        <>
          <Select
            value={override.source.valueType}
            onValueChange={v =>
              setLiteralType(v as 'string' | 'number' | 'boolean' | 'null')
            }
          >
            <SelectTrigger
              className="h-8 w-[4.5rem] shrink-0 px-2 text-xs"
              aria-label="Literal type"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="string">String</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="boolean">Boolean</SelectItem>
              <SelectItem value="null">Null</SelectItem>
            </SelectContent>
          </Select>
          {override.source.valueType === 'string' && (
            <Input
              value={String(override.source.value ?? '')}
              onChange={e =>
                setSourceValue({
                  kind: 'literal',
                  valueType: 'string',
                  value: e.target.value,
                })
              }
              placeholder="value"
              className="h-8 min-w-[8rem] grow basis-[8rem] text-xs"
              aria-label="Literal string value"
            />
          )}
          {override.source.valueType === 'number' && (
            <Input
              type="number"
              value={String(override.source.value ?? 0)}
              onChange={e =>
                setSourceValue({
                  kind: 'literal',
                  valueType: 'number',
                  value: Number(e.target.value || 0),
                })
              }
              placeholder="0"
              className="h-8 w-[5rem] tabular-nums"
              aria-label="Literal number value"
            />
          )}
          {override.source.valueType === 'boolean' && (
            <div className="flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground">
              <Switch
                checked={Boolean(override.source.value)}
                onCheckedChange={checked =>
                  setSourceValue({
                    kind: 'literal',
                    valueType: 'boolean',
                    value: Boolean(checked),
                  })
                }
                aria-label="Literal boolean value"
              />
              <span className="font-mono">
                {override.source.value ? 'true' : 'false'}
              </span>
            </div>
          )}
        </>
      )}

      {override.source.kind === 'field' && (
        <div className="flex min-w-[8rem] grow basis-[8rem]">
          <FieldPicker
            value={override.source.path}
            onPick={path => setSourceValue({ kind: 'field', path })}
            fields={fields}
            placeholder="source field"
            testId={`map-row-${override.id}-field-picker`}
          />
        </div>
      )}

      {override.source.kind === 'expression' && (
        <ExpressionEditor
          value={override.source.expression}
          fields={fields}
          onChange={next =>
            setSourceValue({ kind: 'expression', expression: next })
          }
          testId={`map-row-${override.id}-expression`}
        />
      )}

      <ArrowRight
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />

      <Input
        value={override.targetPath}
        onChange={e => setTargetPath(e.target.value)}
        placeholder="output.path"
        className="h-8 w-[7rem] shrink-0 px-2 font-mono text-xs"
        aria-label="Output path"
      />

      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Remove override"
        className="motion-transform size-7 shrink-0 text-muted-foreground hover:text-destructive active:scale-[0.96]"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

function OmitMultiPicker({
  fields,
  selected,
  onToggle,
  onRemove,
  testId,
}: {
  fields: ReadonlyArray<{ name: string }>;
  selected: ReadonlyArray<string>;
  onToggle: (path: string) => void;
  onRemove: (path: string) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(f => f.name.toLowerCase().includes(q));
  }, [fields, query]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded-md bg-background/50 px-1.5 py-1"
      data-testid={testId}
    >
      <span className="shrink-0 px-1 font-mono text-xs text-muted-foreground">
        drop
      </span>
      {selected.map(path => (
        <Badge
          key={path}
          variant="secondary"
          className="gap-1 py-0.5 pr-1 pl-2 font-mono text-[11px] font-medium"
        >
          <span>{path}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(path)}
            aria-label={`Stop dropping ${path}`}
            className="motion-transform size-4 text-muted-foreground hover:text-destructive active:scale-[0.96]"
            data-testid={testId ? `${testId}-remove-${path}` : undefined}
          >
            <X className="size-3" />
          </Button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="motion-transform h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]"
            aria-label="Add field to drop"
            data-testid={testId ? `${testId}-add` : undefined}
          >
            <Plus className="size-3" />
            <span>{selected.length === 0 ? 'field to drop' : 'add'}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="p-0"
          style={{ width: 240 }}
          onOpenAutoFocus={e => {
            e.preventDefault();
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        >
          <div className="border-b border-divider p-1.5">
            <Input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search fields"
              aria-label="Search fields"
              className="h-7 text-xs"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {fields.length === 0
                  ? 'Dry run the data source to see fields'
                  : 'No matches'}
              </p>
            ) : (
              filtered.map(f => {
                const checked = selectedSet.has(f.name);
                return (
                  <Button
                    key={f.name}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onToggle(f.name)}
                    className={cn(
                      'h-auto w-full justify-start gap-2 rounded-sm px-2 py-1 text-xs font-normal',
                      'hover:bg-accent hover:text-accent-foreground',
                    )}
                    data-testid={
                      testId ? `${testId}-option-${f.name}` : undefined
                    }
                  >
                    <span
                      className={cn(
                        'flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input',
                      )}
                    >
                      {checked && <Check className="size-2.5" />}
                    </span>
                    <span className="truncate font-mono">{f.name}</span>
                  </Button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function MapBuilder({
  rules,
  expression,
  inputSample,
  onChange,
  jsonataAssist,
  testId,
}: MapBuilderProps) {
  const adv = useAdvancedModeState<MapRules>({
    initialStructured: rules,
    initialExpression: expression,
    emptyStructured: EMPTY_RULES,
    parse: parseMapRules,
    compile: compileMap,
    onChange,
  });

  const truncatedSample = useMemo(
    () => (Array.isArray(inputSample) ? inputSample.slice(0, 10) : undefined),
    [inputSample],
  );

  const fields = useMemo(
    () => (truncatedSample ? deriveFields(truncatedSample) : []),
    [truncatedSample],
  );

  // Top-level keys of the input sample, used for the "Omit" picker. Only
  // top-level keys are supported in v1 (compile emits a flat $sift); nested
  // omits should use Advanced JSONata.
  const topLevelFields = useMemo(() => {
    if (!Array.isArray(truncatedSample)) return [];
    const set = new Set<string>();
    for (const item of truncatedSample) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const k of Object.keys(item as Record<string, unknown>)) {
          if (k !== '_parent' && k !== '_additionalData') set.add(k);
        }
      }
    }
    return [...set].sort().map(name => ({ name }));
  }, [truncatedSample]);

  // All mutation callbacks use the functional setStructured form so that two
  // mutations dispatched in the same render frame both see the latest state
  // (the closure captures only setStructured, not adv.structured).
  const setStructured = adv.setStructured;

  const handleToggleOmit = useCallback(
    (path: string) => {
      setStructured(prev => {
        const current = prev.omit ?? [];
        const next = current.includes(path)
          ? current.filter(p => p !== path)
          : [...current, path];
        return { ...prev, omit: next };
      });
    },
    [setStructured],
  );

  const handleRemoveOmit = useCallback(
    (path: string) => {
      setStructured(prev => ({
        ...prev,
        omit: (prev.omit ?? []).filter(p => p !== path),
      }));
    },
    [setStructured],
  );

  const handleAddOverride = useCallback(() => {
    setStructured(prev => ({
      ...prev,
      overrides: [
        ...prev.overrides,
        {
          id: nextOverrideId(),
          targetPath: '',
          source: defaultLiteralSource(),
        },
      ],
    }));
  }, [setStructured]);

  const handleUpdateOverride = useCallback(
    (id: string, replacement: MapOverride) => {
      setStructured(prev => ({
        ...prev,
        overrides: prev.overrides.map(o => (o.id === id ? replacement : o)),
      }));
    },
    [setStructured],
  );

  const handleRemoveOverride = useCallback(
    (id: string) => {
      setStructured(prev => ({
        ...prev,
        overrides: prev.overrides.filter(o => o.id !== id),
      }));
    },
    [setStructured],
  );

  const handlePassthroughToggle = useCallback(
    (checked: boolean) => {
      setStructured(prev => ({ ...prev, passthrough: checked }));
    },
    [setStructured],
  );

  return (
    <div className="flex flex-col gap-3" data-testid={testId ?? 'map-builder'}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Map</h4>
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
          testId="map-builder-confirm"
        />
      )}

      {adv.advancedMode ? (
        <JsonataExpressionField
          value={adv.expression}
          onChange={adv.setAdvancedExpression}
          label="Map Expression"
          placeholder='$merge([$, {"kind": "Component"}])'
          helperText="JSONata expression → entity"
          transformType="map"
          inputSample={truncatedSample}
          jsonataAssist={jsonataAssist}
          testId="jsonata-textarea"
        />
      ) : (
        <div
          data-testid="map-builder-builder"
          className="flex flex-col gap-1.5"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={adv.structured.passthrough}
              onCheckedChange={handlePassthroughToggle}
              aria-label="Pass through input fields"
            />
            <span>Pass through input fields</span>
          </div>

          {adv.structured.passthrough && (
            <OmitMultiPicker
              fields={topLevelFields}
              selected={adv.structured.omit ?? []}
              onToggle={handleToggleOmit}
              onRemove={handleRemoveOmit}
              testId="map-builder-omit-picker"
            />
          )}

          {adv.structured.overrides.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {adv.structured.overrides.map(o => (
                <OverrideRow
                  key={o.id}
                  override={o}
                  fields={fields}
                  onChange={next => handleUpdateOverride(o.id, next)}
                  onRemove={() => handleRemoveOverride(o.id)}
                />
              ))}
            </ul>
          )}
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddOverride}
              className="motion-transform h-7 px-2 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]"
            >
              <Plus className="size-3" />
              <span>Override</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
