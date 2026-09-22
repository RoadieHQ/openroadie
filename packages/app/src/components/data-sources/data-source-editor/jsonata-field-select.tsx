import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Code, List } from 'lucide-react';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { SelectItem } from '@roadiehq/ui/select';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { Button } from '@roadiehq/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@roadiehq/ui/tooltip';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type SelectOption = {
  label: string;
  value: string;
  example: string;
};

type PathInfo = {
  path: string;
  isString: boolean;
  example: JsonValue;
};

type ValidFn = (value: unknown) => boolean;

type ValidatedPathInfo = {
  path: string;
  isString: boolean;
  example: JsonValue;
};

const defaultValid: ValidFn = value =>
  typeof value === 'string' || typeof value === 'number';

const JSONATA_SPECIAL_CHARS = /[.[\](){}$@#*~`\s'"\\]/;

function appendKey(path: string, key: string): string {
  if (JSONATA_SPECIAL_CHARS.test(key)) {
    const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${path}["${escaped}"]`;
  }
  return path === '$' ? `$.${key}` : `${path}.${key}`;
}

function formatExample(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value.length > 30 ? `${value.slice(0, 30)}…` : value;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  return '{…}';
}

function getJsonType(v: JsonValue): string {
  if (v === null) {
    return 'null';
  }
  if (Array.isArray(v)) {
    return 'array';
  }
  return typeof v;
}

function getValueAtPath(obj: JsonValue, path: string): JsonValue | undefined {
  if (path === '$') {
    return obj;
  }
  let normalizedPath = path;
  if (normalizedPath.startsWith('$.')) {
    normalizedPath = normalizedPath.slice(2);
  } else if (normalizedPath.startsWith('$[')) {
    normalizedPath = normalizedPath.slice(1);
  } else if (normalizedPath.startsWith('$')) {
    normalizedPath = normalizedPath.slice(1);
  }
  const parts = parsePathSegments(normalizedPath);
  let current: JsonValue | undefined = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (isNaN(idx) || idx < 0 || idx >= current.length) {
        return undefined;
      }
      current = current.at(idx);
    } else {
      // Object.hasOwn distinguishes a missing key from a key whose value is
      // explicitly `undefined`, preserving traversal semantics for objects
      // with undefined-valued keys.
      const record = current as Record<string, JsonValue>;
      if (!Object.hasOwn(record, part)) {
        return undefined;
      }
      current = record[`${part}`] as JsonValue;
    }
  }
  return current;
}

// Parses JSONata-ish paths like `foo.bar[0]["baz"]` into segments without using
// a regex with nested quantifiers (security/detect-unsafe-regex).
function parsePathSegments(path: string): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < path.length) {
    const ch = path.charAt(i);
    if (ch === '.') {
      i++;
      continue;
    }
    // Stray `]` (e.g. malformed `foo]bar`) — skip past it. Without this
    // guard the unquoted-key branch below would break immediately on `]`
    // (it's in the break set) without advancing `i`, infinite-looping the
    // outer while.
    if (ch === ']') {
      i++;
      continue;
    }
    if (ch === '[') {
      const next = path.charAt(i + 1);
      if (next === '"') {
        // Quoted key: consume until unescaped closing quote.
        i += 2;
        let key = '';
        while (i < path.length) {
          const c = path.charAt(i);
          if (c === '\\' && i + 1 < path.length) {
            key += path.charAt(i + 1);
            i += 2;
            continue;
          }
          if (c === '"') {
            break;
          }
          key += c;
          i++;
        }
        parts.push(key);
        // Skip closing `"` and `]`.
        if (path.charAt(i) === '"') i++;
        if (path.charAt(i) === ']') i++;
        continue;
      }
      let digits = '';
      i++;
      while (i < path.length && path.charAt(i) !== ']') {
        digits += path.charAt(i);
        i++;
      }
      if (path.charAt(i) === ']') i++;
      if (digits.length > 0) {
        parts.push(digits);
      }
      continue;
    }
    let key = '';
    while (i < path.length) {
      const c = path.charAt(i);
      if (c === '.' || c === '[' || c === ']') break;
      key += c;
      i++;
    }
    if (key.length > 0) {
      parts.push(key);
    }
  }
  return parts;
}

function validatePath(
  path: string,
  info: PathInfo,
  objects: JsonValue[],
  valid: ValidFn,
  /** When true, repeated values across rows are allowed (e.g. datastore unique index used for dedupe). */
  allowDuplicateSampleValues = false,
): ValidatedPathInfo | null {
  if (path === '$') {
    return { path: info.path, isString: info.isString, example: info.example };
  }

  const values: JsonValue[] = [];
  const seen = new Set<string>();
  let firstType: string | null = null;

  for (const obj of objects) {
    const val = getValueAtPath(obj, path);
    if (val === undefined || !valid(val)) {
      return null;
    }

    if (!allowDuplicateSampleValues) {
      const key = JSON.stringify(val);
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
    }

    const valType = getJsonType(val);
    if (firstType === null) {
      firstType = valType;
    } else if (valType !== firstType) {
      return null;
    }

    values.push(val);
  }

  const isString = values.every(v => typeof v === 'string');
  return { path: info.path, isString, example: info.example };
}

function sampleValueForSchemaType(
  type: string,
  valid: ValidFn,
): JsonValue | undefined {
  if (type === 'string') {
    return valid('example') ? 'example' : undefined;
  }
  if (type === 'integer' || type === 'number') {
    return valid(1) ? 1 : undefined;
  }
  return undefined;
}

function buildJsonataSelectOptionsFromSchema(
  schema: JsonValue,
  valid: ValidFn,
  outputType: 'string' | 'array',
): SelectOption[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [];
  }

  const paths: Array<{ path: string; isString: boolean; example: string }> = [];

  const collectSchemaPaths = (node: JsonValue, path: string): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }
    const schemaNode = node as Record<string, JsonValue>;
    const type = schemaNode.type as string | undefined;
    const format = schemaNode.format as string | undefined;

    if (path !== '$' && type) {
      const sample = sampleValueForSchemaType(type, valid);
      if (sample !== undefined) {
        const exampleText = format ? `${type} (${format})` : type;
        paths.push({
          path,
          isString: type === 'string',
          example: exampleText,
        });
        return;
      }
    }

    if (type === 'object' && schemaNode.properties) {
      const props = schemaNode.properties as Record<string, JsonValue>;
      const entries = Object.entries(props).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      for (const [key, child] of entries) {
        collectSchemaPaths(child, appendKey(path, key));
      }
    }
  };

  collectSchemaPaths(schema, '$');

  return paths
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, isString, example }) => {
      let label = path;
      if (path.startsWith('$.')) {
        label = path.slice(2);
      }
      const needsStringWrap = outputType === 'string' && !isString;
      const value = needsStringWrap ? `$string(${path})` : path;
      return { label, value, example };
    });
}

function buildJsonataSelectOptions(
  objects: JsonValue[],
  valid: ValidFn,
  outputType: 'string' | 'array',
  allowDuplicateSampleValues = false,
  includeRoot = true,
): SelectOption[] {
  const pathMap = new Map<string, PathInfo>();

  if (includeRoot && valid(objects)) {
    pathMap.set('$', { path: '$', isString: false, example: objects });
  }

  for (const obj of objects) {
    collectPaths(obj, '$', pathMap, valid);
  }

  const validatedPaths: ValidatedPathInfo[] = [];
  for (const [path, info] of pathMap) {
    const validated = validatePath(
      path,
      info,
      objects,
      valid,
      allowDuplicateSampleValues,
    );
    if (validated) {
      validatedPaths.push(validated);
    }
  }

  return validatedPaths
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, isString, example }) => {
      let label = path;
      if (path === '$') {
        label = '$';
      } else if (path.startsWith('$.')) {
        label = path.slice(2);
      }
      const needsStringWrap = outputType === 'string' && !isString;
      const value = needsStringWrap ? `$string(${path})` : path;
      return { label, value, example: formatExample(example) };
    });
}

function collectPaths(
  value: JsonValue,
  path: string,
  out: Map<string, PathInfo>,
  valid: ValidFn,
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value !== 'object') {
    if (path !== '$' && valid(value)) {
      const isString = typeof value === 'string';
      const existing = out.get(path);
      if (!existing) {
        out.set(path, { path, isString, example: value });
      } else if (existing.isString && !isString) {
        out.set(path, { path, isString: false, example: value });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    if (path === '$') {
      return;
    }
    if (valid(value)) {
      const existing = out.get(path);
      if (!existing) {
        out.set(path, { path, isString: false, example: value });
      }
    }
    if (value.length > 0) {
      const p0 = `${path}[0]`;
      collectPaths(value[0], p0, out, valid);
    }
    return;
  }

  if (valid(value)) {
    if (path !== '$') {
      const existing = out.get(path);
      if (!existing) {
        out.set(path, { path, isString: false, example: value });
      }
    }
  }

  const obj: Record<string, JsonValue> = value;
  for (const [key, child] of Object.entries(obj)) {
    collectPaths(child, appendKey(path, key), out, valid);
  }
}

export interface JsonataFieldSelectProps {
  data: unknown;
  schemaData?: unknown;
  value?: string;
  label?: string;
  onChange?: (e: { target: { value: string } }) => void;
  helperText?: string;
  valid?: ValidFn;
  outputType?: 'string' | 'array';
  allowDuplicateSampleValues?: boolean;
  /**
   * Whether `$` (the item itself) is offered alongside its fields. Off for
   * pickers where the whole item is never a sensible answer — a flatmap's
   * array field, say, since `$` there expands an item into itself.
   */
  includeRoot?: boolean;
}

export function JsonataFieldSelect({
  data,
  schemaData,
  value = '',
  label = '',
  onChange,
  helperText,
  valid = defaultValid,
  outputType = 'string',
  allowDuplicateSampleValues = false,
  includeRoot = true,
}: JsonataFieldSelectProps) {
  const options = useMemo(() => {
    const dataArray = Array.isArray(data) ? (data as JsonValue[]) : [];
    if (dataArray.length > 0) {
      return buildJsonataSelectOptions(
        dataArray,
        valid,
        outputType,
        allowDuplicateSampleValues,
        includeRoot,
      );
    }
    if (schemaData) {
      return buildJsonataSelectOptionsFromSchema(
        schemaData as JsonValue,
        valid,
        outputType,
      );
    }
    return [];
  }, [
    data,
    schemaData,
    valid,
    outputType,
    allowDuplicateSampleValues,
    includeRoot,
  ]);

  const valueInOptions = useMemo(
    () => options.some(opt => opt.value === value),
    [options, value],
  );

  const [advancedMode, setAdvancedMode] = useState(false);
  const prevOptionsRef = useRef(options);

  useEffect(() => {
    const optionsChanged = prevOptionsRef.current !== options;
    prevOptionsRef.current = options;

    if (optionsChanged && valueInOptions) {
      setAdvancedMode(false);
    } else if (value && !valueInOptions && options.length > 0) {
      setAdvancedMode(true);
    }
  }, [value, valueInOptions, options]);

  const toggleMode = () => setAdvancedMode(prev => !prev);
  const canSwitchToDropdown = options.length > 0;
  const toggleLabel = advancedMode
    ? 'Switch to dropdown'
    : 'Switch to advanced mode';

  const modeToggleButton = (rightClass = 'right-2') => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleMode}
          disabled={advancedMode && !canSwitchToDropdown}
          aria-label={toggleLabel}
          className={`absolute top-1/2 ${rightClass} h-auto w-auto -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50`}
        >
          {advancedMode ? (
            <List className="size-4" />
          ) : (
            <Code className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{toggleLabel}</TooltipContent>
    </Tooltip>
  );

  if (advancedMode) {
    return (
      <div>
        <div className="relative">
          <OutlinedInput
            label={label}
            value={value}
            onChange={e => onChange?.({ target: { value: e.target.value } })}
            className="pr-9"
          />
          {modeToggleButton()}
        </div>
        {helperText && (
          <p className="mt-1 px-input-x text-xs text-muted-foreground">
            {helperText}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <OutlinedSelect
          label={label}
          value={value}
          onValueChange={val => onChange?.({ target: { value: val } })}
          hideChevron
        >
          {options.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>
              <span>{opt.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {opt.example}
              </span>
            </SelectItem>
          ))}
        </OutlinedSelect>
        {modeToggleButton()}
      </div>
      {helperText && (
        <p className="mt-1 px-input-x text-xs text-muted-foreground">
          {helperText}
        </p>
      )}
    </div>
  );
}
