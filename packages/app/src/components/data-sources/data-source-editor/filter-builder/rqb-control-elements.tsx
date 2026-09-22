import React, { useMemo, useState } from 'react';
import { Plus, FolderPlus, Trash2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import { Switch } from '@roadiehq/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { cn } from '@roadiehq/ui/utils';
import type {
  ActionProps,
  CombinatorSelectorProps,
  ControlElementsProp,
  FieldSelectorProps,
  FullField,
  NotToggleProps,
  OperatorSelectorProps,
  ValueEditorProps,
} from 'react-querybuilder';

interface BasicOption {
  name?: string;
  value?: string;
  label?: string;
}

interface OptionGroup {
  label?: string;
  options?: ReadonlyArray<BasicOption>;
}

function flattenOptions(
  options: ReadonlyArray<unknown> | undefined,
): BasicOption[] {
  if (!options) {
    return [];
  }
  const out: BasicOption[] = [];
  for (const item of options) {
    if (item && typeof item === 'object') {
      const candidate = item as OptionGroup & BasicOption;
      if (Array.isArray(candidate.options)) {
        for (const sub of candidate.options) {
          if (sub) {
            out.push(sub);
          }
        }
        continue;
      }
      out.push(candidate);
    }
  }
  return out;
}

function getOptionValue(opt: BasicOption): string {
  return opt.value ?? opt.name ?? '';
}

function getOptionLabel(opt: BasicOption): string {
  return opt.label ?? getOptionValue(opt);
}

/**
 * Type-ahead field selector.
 *
 * The user can type a path directly (works even for fields that aren't in the
 * dry-run sample). A popover lists matching options below the input as they
 * type. Picking an option commits it and closes the list.
 */
function FieldSelector(props: FieldSelectorProps<FullField>) {
  const { value, handleOnChange, options, disabled, testID } = props;
  const fields = useMemo(
    () =>
      flattenOptions(options).map(o => ({
        name: getOptionValue(o),
        label: getOptionLabel(o),
      })),
    [options],
  );

  const [draft, setDraft] = useState<string>(value ?? '');
  const [open, setOpen] = useState(false);
  const blurTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  React.useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return fields.slice(0, 50);
    return fields
      .filter(
        f =>
          f.name.toLowerCase().includes(q) ||
          f.label?.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [draft, fields]);

  const commit = (next: string) => {
    setDraft(next);
    handleOnChange(next);
    setOpen(false);
  };

  return (
    <div className="relative w-[7.5rem] shrink-0">
      <Input
        value={draft}
        onChange={e => {
          setDraft(e.target.value);
          handleOnChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && filtered.length > 0) {
            const exact = filtered.find(
              f => f.name.toLowerCase() === draft.trim().toLowerCase(),
            );
            commit((exact ?? filtered[0]).name);
            e.preventDefault();
          }
        }}
        placeholder="field"
        aria-label="Field"
        disabled={disabled}
        data-testid={testID}
        className="h-8 px-2 font-mono text-xs"
      />
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-full left-0 z-50 mt-1 max-h-60 w-[14rem] overflow-y-auto rounded-md border border-divider bg-popover p-1 text-popover-foreground shadow-md"
        >
          {filtered.map(f => (
            <li
              key={f.name}
              role="option"
              aria-selected={f.name === draft}
              onMouseDown={e => {
                e.preventDefault();
                commit(f.name);
              }}
              className={cn(
                'cursor-pointer truncate rounded-sm px-2 py-1 font-mono text-xs',
                'hover:bg-accent hover:text-accent-foreground',
                f.name === draft && 'bg-accent text-accent-foreground',
              )}
            >
              {f.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NamedSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  testID,
  triggerClassName,
  ariaLabel,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  options: BasicOption[];
  disabled?: boolean;
  placeholder?: string;
  testID?: string;
  triggerClassName?: string;
  /** The control's accessible name — the visible text is only a placeholder. */
  ariaLabel: string;
}) {
  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={cn('h-8 px-2 text-xs', triggerClassName)}
        data-testid={testID}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={getOptionValue(o)} value={getOptionValue(o)}>
            {getOptionLabel(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OperatorSelector(props: OperatorSelectorProps) {
  const { value, handleOnChange, options, disabled, testID } = props;
  const flat = useMemo(() => flattenOptions(options), [options]);
  return (
    <div className="w-[5.5rem] shrink-0">
      <NamedSelect
        value={value}
        onChange={handleOnChange}
        options={flat}
        disabled={disabled}
        placeholder="op"
        testID={testID}
        ariaLabel="Operator"
      />
    </div>
  );
}

function CombinatorSelector(props: CombinatorSelectorProps) {
  const { value, handleOnChange, options, disabled, testID } = props;
  const flat = useMemo(() => flattenOptions(options), [options]);
  return (
    <NamedSelect
      value={value}
      onChange={handleOnChange}
      options={flat}
      disabled={disabled}
      placeholder="combinator"
      testID={testID}
      ariaLabel="Combine rules with"
      triggerClassName="h-7 w-[5rem] rounded-full bg-primary/10 text-[11px] font-semibold uppercase tracking-wider text-primary border-primary/20 hover:bg-primary/15"
    />
  );
}

function ValueSelectEditor({
  value,
  onChange,
  valuesProp,
  disabled,
  testID,
}: {
  value: string;
  onChange: (value: string) => void;
  valuesProp: ReadonlyArray<unknown> | undefined;
  disabled?: boolean;
  testID?: string;
}) {
  const flat = useMemo(() => flattenOptions(valuesProp), [valuesProp]);
  return (
    <NamedSelect
      value={value}
      onChange={onChange}
      options={flat}
      disabled={disabled}
      placeholder="value"
      testID={testID}
      ariaLabel="Value"
      triggerClassName="min-w-[5rem] grow basis-0"
    />
  );
}

function ValueEditor(props: ValueEditorProps<FullField>) {
  const {
    value,
    handleOnChange,
    type,
    inputType,
    values,
    operator,
    disabled,
    testID,
  } = props;

  if (operator === 'null' || operator === 'notNull') {
    return null;
  }

  if (type === 'checkbox') {
    // The value may be the string 'true'/'false' when the rule was typed
    // before the field's boolean type was derived — Boolean('false') is true,
    // so coerce by literal instead.
    const boolValue = value === true || value === 'true';
    return (
      <div className="flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground">
        <Switch
          checked={boolValue}
          onCheckedChange={checked => handleOnChange(Boolean(checked))}
          disabled={disabled}
          aria-label="Boolean value"
          data-testid={testID}
        />
        <span className="font-mono">{boolValue ? 'true' : 'false'}</span>
      </div>
    );
  }

  if (type === 'select') {
    return (
      <ValueSelectEditor
        value={value === undefined || value === null ? '' : String(value)}
        onChange={handleOnChange}
        valuesProp={values as ReadonlyArray<unknown> | undefined}
        disabled={disabled}
        testID={testID}
      />
    );
  }

  const isMulti = operator === 'in' || operator === 'notIn';

  return (
    <Input
      type={inputType ?? 'text'}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={e => handleOnChange(e.target.value)}
      placeholder={isMulti ? 'a, b, c' : 'value'}
      disabled={disabled}
      data-testid={testID}
      className="h-8 min-w-[5rem] grow basis-0 text-xs"
    />
  );
}

function AddRuleAction(props: ActionProps) {
  const { handleOnClick, disabled, testID } = props;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={e => handleOnClick(e)}
      disabled={disabled}
      data-testid={testID}
      className="motion-transform h-7 px-2 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]"
    >
      <Plus className="size-3" />
      <span>Rule</span>
    </Button>
  );
}

function AddGroupAction(props: ActionProps) {
  const { handleOnClick, disabled, testID } = props;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={e => handleOnClick(e)}
      disabled={disabled}
      data-testid={testID}
      className="motion-transform h-7 px-2 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]"
    >
      <FolderPlus className="size-3" />
      <span>Group</span>
    </Button>
  );
}

function RemoveRuleAction(props: ActionProps) {
  const { handleOnClick, disabled, testID } = props;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={e => handleOnClick(e)}
      disabled={disabled}
      data-testid={testID}
      aria-label="Remove rule"
      className="motion-transform size-7 shrink-0 text-muted-foreground hover:text-destructive active:scale-[0.96]"
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

function NotToggle(props: NotToggleProps) {
  const { checked, handleOnChange, testID } = props;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Switch
        checked={Boolean(checked)}
        onCheckedChange={c => handleOnChange(Boolean(c))}
        aria-label="Negate group"
        data-testid={testID}
      />
      <span>Not</span>
    </div>
  );
}

export const roadieControlElements: ControlElementsProp<FullField, string> = {
  fieldSelector: FieldSelector,
  operatorSelector: OperatorSelector,
  combinatorSelector: CombinatorSelector,
  valueEditor: ValueEditor,
  addRuleAction: AddRuleAction,
  addGroupAction: AddGroupAction,
  removeRuleAction: RemoveRuleAction,
  removeGroupAction: RemoveRuleAction,
  notToggle: NotToggle,
};

export const roadieControlClassnames = {
  queryBuilder: 'rqb-roadie flex flex-col gap-2',
  // Top-level and nested groups get the same surface so the structure reads
  // as a uniform tree of AND/OR boxes. The "Filter" pipeline step that wraps
  // this builder should not add another bordered card around the top group;
  // that's the caller's responsibility.
  ruleGroup:
    'group/rg flex flex-col gap-1.5 rounded-md border border-divider/60 bg-muted/20 p-2',
  header: 'flex flex-wrap items-center gap-1.5',
  body: 'flex flex-col gap-1.5',
  rule: 'flex flex-row flex-wrap items-center gap-1.5 rounded-md bg-background/50 px-1.5 py-1',
} as const;
