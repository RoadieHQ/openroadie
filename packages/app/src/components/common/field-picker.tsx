import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import { cn } from '@roadiehq/ui/utils';

interface FlatField {
  name: string;
  label?: string;
}

interface TreeNode {
  segment: string;
  path: string;
  pickable: boolean;
  children: TreeNode[];
}

function buildTree(fields: ReadonlyArray<FlatField>): TreeNode[] {
  const root: TreeNode = {
    segment: '',
    path: '',
    pickable: false,
    children: [],
  };

  for (const field of fields) {
    const segments = field.name.split('.').filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    let cursor = root;
    let acc = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments.at(i)!;
      acc = acc ? `${acc}.${seg}` : seg;
      let child = cursor.children.find(c => c.segment === seg);
      if (!child) {
        child = {
          segment: seg,
          path: acc,
          pickable: false,
          children: [],
        };
        cursor.children.push(child);
      }
      if (i === segments.length - 1) {
        child.pickable = true;
      }
      cursor = child;
    }
  }

  return root.children;
}

function collectAllPaths(nodes: ReadonlyArray<TreeNode>): string[] {
  const out: string[] = [];
  const walk = (list: ReadonlyArray<TreeNode>) => {
    for (const node of list) {
      if (node.pickable) {
        out.push(node.path);
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onPick,
}: {
  node: TreeNode;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onPick: (path: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.path);

  const handleClick = () => {
    if (node.pickable) {
      onPick(node.path);
      return;
    }
    if (hasChildren) {
      onToggle(node.path);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKey}
        className={cn(
          'flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs',
          'hover:bg-accent hover:text-accent-foreground',
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        data-testid={`field-picker-row-${node.path}`}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={e => {
              e.stopPropagation();
              onToggle(node.path);
            }}
            className="size-3.5 p-0 text-muted-foreground hover:text-foreground"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            {isOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </Button>
        ) : (
          <span className="size-3.5" />
        )}
        <span
          className={cn(
            'truncate font-mono',
            !node.pickable && 'text-muted-foreground',
          )}
        >
          {node.segment}
        </span>
      </div>
      {hasChildren && isOpen && (
        <>
          {node.children.map(child => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onPick={onPick}
            />
          ))}
        </>
      )}
    </>
  );
}

export interface FieldPickerProps {
  value?: string;
  onPick: (path: string) => void;
  fields: ReadonlyArray<FlatField>;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  /**
   * Optional content for the trigger. If omitted, renders a default
   * Button showing the current value or placeholder.
   */
  trigger?: React.ReactNode;
  /**
   * Trigger ARIA label (also used as default tooltip). Defaults to "Pick a field".
   */
  triggerLabel?: string;
  /**
   * Width of the popover content in px. Defaults to 280.
   */
  popoverWidth?: number;
}

export function FieldPicker({
  value,
  onPick,
  fields,
  placeholder = 'Select a field',
  disabled,
  testId,
  trigger,
  triggerLabel = 'Pick a field',
  popoverWidth = 280,
}: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildTree(fields), [fields]);
  const allPaths = useMemo(() => collectAllPaths(tree), [tree]);

  const filteredMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return null;
    }
    return allPaths.filter(p => p.toLowerCase().includes(q));
  }, [allPaths, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open]);

  const toggleExpanded = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const pick = (path: string) => {
    onPick(path);
    setOpen(false);
  };

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      className={cn(
        'motion-transform h-8 w-full justify-start px-2 font-mono text-xs font-normal active:scale-[0.96]',
        !value && 'text-muted-foreground',
      )}
      data-testid={testId}
      aria-label={triggerLabel}
    >
      <span className="truncate">{value || placeholder}</span>
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? defaultTrigger}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0"
        style={{ width: popoverWidth }}
      >
        <div className="border-b border-divider p-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search fields"
              aria-label="Search fields"
              className="h-7 pl-7 text-xs"
              data-testid={testId ? `${testId}-search` : 'field-picker-search'}
            />
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {tree.length === 0 ? (
            <div className="p-2 text-center text-xs text-muted-foreground italic">
              Dry run the data source to see fields
            </div>
          ) : filteredMatches !== null ? (
            filteredMatches.length === 0 ? (
              <div className="p-2 text-center text-xs text-muted-foreground italic">
                No matches
              </div>
            ) : (
              filteredMatches.map(path => (
                <div
                  key={path}
                  role="button"
                  tabIndex={0}
                  onClick={() => pick(path)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      pick(path);
                    }
                  }}
                  className="flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-xs hover:bg-accent hover:text-accent-foreground"
                  data-testid={`field-picker-match-${path}`}
                >
                  <span className="truncate">{path}</span>
                </div>
              ))
            )
          ) : (
            tree.map(node => (
              <TreeRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggleExpanded}
                onPick={pick}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
