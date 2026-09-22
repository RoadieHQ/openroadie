import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, FunctionSquare } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { buildFieldExpression, type PickedSegment } from './field-expression';

// A compact tree of properties and values — no JSON braces/quotes, just
// key → value rows. Nested objects/arrays are collapsible nodes (collapsed by
// default to stay compact). A matched property (given as a key path) is
// highlighted; the containers along the path auto-expand and the matched row is
// scrolled into view — so a join on a nested field (e.g. `_parent.id`, or a
// value inside an array like `items[*].full_name`) is visible without hunting.
//
// When `onPick` is given, leaf rows are clickable: picking one sets the field
// to its accessor expression (array steps become `[*]` wildcards). The
// highlighted row shows an "advanced expression" icon when the configured value
// can't be represented by a plain pick.

function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function entriesOf(value: object): [string, unknown][] {
  return Array.isArray(value)
    ? value.map((item, i) => [String(i), item] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);
}

function formatLeaf(value: unknown): string {
  if (value == null) {
    return '—';
  }
  return typeof value === 'string' ? value : String(value);
}

const ROW =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-baseline gap-2';

function PropertyNode({
  name,
  value,
  segments,
  targetHere,
  advanced,
  descendPath,
  scrollRef,
  onPick,
}: {
  name: string;
  value: unknown;
  // The accessor segments from the root down to and including this node.
  segments: PickedSegment[];
  // This row is the highlighted target.
  targetHere?: boolean;
  // The highlighted target holds an advanced (non-pickable) expression.
  advanced?: boolean;
  // Remaining key path from this node's children down to the target (drives
  // auto-expand); empty/undefined when the target isn't inside this node.
  descendPath?: string[];
  // Forwarded down the path so the target row can be scrolled into view.
  scrollRef?: (el: HTMLElement | null) => void;
  // Select this property (called with its accessor expression) when picking.
  onPick?: (expr: string) => void;
}) {
  const container = isContainer(value);
  const children = container ? entriesOf(value) : [];
  const hasChildren = children.length > 0;
  const isArray = Array.isArray(value);
  const mustExpand = (descendPath?.length ?? 0) > 0;
  const [open, setOpen] = useState(mustExpand);

  useEffect(() => {
    if (mustExpand) {
      setOpen(true);
    }
  }, [mustExpand]);

  const highlight = !!targetHere;
  const keyClass = cn(
    'truncate font-mono text-2xs',
    highlight ? 'font-medium text-primary' : 'text-muted-foreground',
  );
  if (hasChildren) {
    return (
      <div ref={highlight ? scrollRef : undefined}>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={cn(
            ROW,
            'h-auto w-full justify-start rounded px-1 py-0 text-left leading-5 font-normal [&_svg]:size-3',
            highlight
              ? 'bg-primary/10 hover:bg-primary/10'
              : 'hover:bg-muted/50',
          )}
        >
          <span className="flex min-w-0 items-center gap-1">
            <ChevronRight
              className={cn(
                'motion-transform shrink-0 text-muted-foreground',
                open && 'rotate-90',
              )}
            />
            <span className={keyClass} title={name}>
              {name}
            </span>
            {highlight && advanced && (
              <FunctionSquare
                className="shrink-0 text-primary"
                aria-label="Advanced expression configured"
              />
            )}
          </span>
        </Button>
        {open && (
          <div className="ml-2 border-l border-border pl-2">
            {children.map(([k, v]) => {
              const onPath = !!descendPath && descendPath[0] === k;
              const rest = onPath ? descendPath.slice(1) : undefined;
              return (
                <PropertyNode
                  key={k}
                  name={k}
                  value={v}
                  segments={[...segments, { key: k, inArray: isArray }]}
                  targetHere={onPath && rest?.length === 0}
                  advanced={advanced}
                  descendPath={rest}
                  scrollRef={onPath ? scrollRef : undefined}
                  onPick={onPick}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const leafBody = (
    <>
      <span className={keyClass} title={name}>
        {name}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            'min-w-0 truncate font-mono text-2xs',
            highlight ? 'font-medium text-primary' : 'text-foreground',
          )}
          title={formatLeaf(value)}
        >
          {formatLeaf(value)}
        </span>
        {highlight && advanced && (
          <FunctionSquare
            className="size-3 shrink-0 text-primary"
            aria-label="Advanced expression configured"
          />
        )}
      </span>
    </>
  );

  const leafClass = cn(
    ROW,
    'rounded px-1 leading-5',
    highlight && 'bg-primary/10',
  );

  if (onPick) {
    return (
      <Button
        type="button"
        variant="ghost"
        ref={highlight ? scrollRef : undefined}
        onClick={() => onPick(buildFieldExpression(segments))}
        title={`Use ${name} as the field`}
        className={cn(
          leafClass,
          'h-auto w-full justify-start rounded py-0 text-left font-normal hover:bg-muted/50',
          highlight && 'hover:bg-primary/10',
        )}
      >
        {leafBody}
      </Button>
    );
  }

  return (
    <div ref={highlight ? scrollRef : undefined} className={leafClass}>
      {leafBody}
    </div>
  );
}

export function ObjectPropertyTree({
  value,
  highlightPath,
  advanced,
  onPick,
}: {
  value?: unknown;
  highlightPath?: string[];
  // The highlighted (matched) value is an advanced expression — flags it in-tree.
  advanced?: boolean;
  // When given, leaf rows become clickable and pick that property as the field.
  onPick?: (expr: string) => void;
}) {
  const scrollTarget = useRef<HTMLElement | null>(null);
  const scrollRef = useCallback((el: HTMLElement | null) => {
    scrollTarget.current = el;
  }, []);
  const pathKey = highlightPath?.join('.') ?? '';

  useEffect(() => {
    scrollTarget.current?.scrollIntoView({ block: 'nearest' });
  }, [value, pathKey]);

  if (!isContainer(value)) {
    return <p className="text-2xs text-muted-foreground">No properties.</p>;
  }
  const entries = entriesOf(value);
  if (entries.length === 0) {
    return <p className="text-2xs text-muted-foreground">No properties.</p>;
  }
  const isArray = Array.isArray(value);
  const path = highlightPath ?? [];
  return (
    <div className="flex flex-col">
      {entries.map(([k, v]) => {
        const onPath = path[0] === k;
        const rest = onPath ? path.slice(1) : undefined;
        return (
          <PropertyNode
            key={k}
            name={k}
            value={v}
            segments={[{ key: k, inArray: isArray }]}
            targetHere={onPath && rest?.length === 0}
            advanced={advanced}
            descendPath={rest}
            scrollRef={onPath ? scrollRef : undefined}
            onPick={onPick}
          />
        );
      })}
    </div>
  );
}
