import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Badge } from '@roadiehq/ui/badge';
import { cn } from '@roadiehq/ui/utils';

// the motion lint bans the literal 'transition' in strings; false positive here
// eslint-disable-next-line no-restricted-syntax
const TRANSITION_KIND = 'transition' as const;

export type GhostCell =
  | { kind: 'icon'; icon: LucideIcon }
  | { kind: 'title'; text: string; subtext?: string }
  | { kind: 'badge'; text: string }
  | { kind: 'status'; text: string }
  | { kind: 'text'; text: string }
  | { kind: typeof TRANSITION_KIND; from: string; to: string };

export type GhostRow = GhostCell[];

export function ghostTransitionCell(from: string, to: string): GhostCell {
  return { kind: TRANSITION_KIND, from, to };
}

export interface GhostTablePreviewProps {
  headers: string[];
  columns: string;
  rows: GhostRow[];
}

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];
const HEADER_STEP = 0.08;
const ROWS_START = 0.4;
const ROW_STEP = 0.55;
const CELL_STEP = 0.12;

export function ghostSettleAt(rowCount: number, cellCount: number): number {
  return ROWS_START + (rowCount - 1) * ROW_STEP + cellCount * CELL_STEP + 0.5;
}

function GhostCellView({
  cell,
  delay,
  reduced,
}: {
  cell: GhostCell;
  delay: number;
  reduced: boolean;
}): JSX.Element {
  switch (cell.kind) {
    case 'icon': {
      const Icon = cell.icon;
      return (
        <motion.span
          className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"
          initial={reduced ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay, duration: 0.3, ease: EASE }}
        >
          <Icon className="size-4" />
        </motion.span>
      );
    }
    case 'title':
      return (
        <span className="flex min-w-0 flex-col">
          <motion.span
            className="overflow-hidden text-sm font-medium whitespace-nowrap text-foreground"
            initial={reduced ? false : { clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: 'inset(0 0% 0 0)' }}
            transition={{ delay, duration: 0.4, ease: EASE }}
          >
            {cell.text}
          </motion.span>
          {cell.subtext ? (
            <motion.span
              className="font-mono text-[10px] text-muted-foreground"
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: delay + 0.15, duration: 0.3, ease: EASE }}
            >
              {cell.subtext}
            </motion.span>
          ) : null}
        </span>
      );
    case 'badge':
      return (
        <motion.span
          className="inline-flex"
          initial={reduced ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay, duration: 0.25, ease: EASE }}
        >
          <Badge variant="secondary" className="font-mono text-[10px]">
            {cell.text}
          </Badge>
        </motion.span>
      );
    case 'status':
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <motion.span
            className="inline-block size-1.5 shrink-0 rounded-full bg-success"
            initial={reduced ? false : { opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay, duration: 0.35, ease: EASE }}
          />
          <motion.span
            className="whitespace-nowrap"
            initial={reduced ? false : { opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: delay + 0.1, duration: 0.3, ease: EASE }}
          >
            {cell.text}
          </motion.span>
        </span>
      );
    case 'text':
      return (
        <motion.span
          className="text-xs whitespace-nowrap text-muted-foreground"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay, duration: 0.4, ease: EASE }}
        >
          {cell.text}
        </motion.span>
      );
    case TRANSITION_KIND: {
      if (reduced) {
        return (
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {cell.to}
          </span>
        );
      }
      return (
        <span className="relative inline-block font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          <motion.span
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{
              delay,
              duration: 0.9,
              times: [0, 0.25, 0.65, 1],
              ease: EASE,
            }}
          >
            {cell.from}
          </motion.span>
          <motion.span
            className="inline-block"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.7, duration: 0.35, ease: EASE }}
          >
            {cell.to}
          </motion.span>
        </span>
      );
    }
  }
}

/**
 * Decorative preview of a populated overview table. Mirrors the real row
 * anatomy without sharing code, so it may drift when columns change.
 */
export function GhostTablePreview({
  headers,
  columns,
  rows,
}: GhostTablePreviewProps): JSX.Element {
  const reduced = useReducedMotion() ?? false;

  // an extra leading track means an icon column; the first header spans both
  const trackCount = columns
    .replace(/\([^)]*\)/g, '()')
    .trim()
    .split(/\s+/).length;
  const spanFirstHeader = trackCount === headers.length + 1;
  const maxCells = Math.max(...rows.map(row => row.length), 0);
  const settleDelay = ghostSettleAt(rows.length, maxCells);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none text-left select-none"
    >
      <div className="relative">
        <div
          className="grid h-9 items-center gap-x-4 border-b border-border"
          style={{ gridTemplateColumns: columns }}
        >
          {headers.map((header, headerIndex) => (
            <motion.span
              key={header}
              className={cn(
                'text-[11px] font-semibold tracking-wide text-muted-foreground uppercase',
                headerIndex === headers.length - 1 && 'text-right',
              )}
              style={
                headerIndex === 0 && spanFirstHeader
                  ? { gridColumn: 'span 2' }
                  : undefined
              }
              initial={reduced ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: headerIndex * HEADER_STEP,
                duration: 0.35,
                ease: EASE,
              }}
            >
              {header}
            </motion.span>
          ))}
        </div>

        <motion.div
          initial={reduced ? { opacity: 0.4 } : { opacity: 1 }}
          animate={{ opacity: 0.4 }}
          transition={{ delay: settleDelay, duration: 0.6, ease: EASE }}
        >
          {rows.map((row, rowIndex) => (
            <div
              key={`ghost-row-${rowIndex}`}
              className={cn(
                'grid h-14 items-center gap-x-4',
                rowIndex < rows.length - 1 &&
                  'border-b border-dashed border-border',
              )}
              style={{ gridTemplateColumns: columns }}
            >
              {row.map((cell, cellIndex) => (
                <div
                  key={`ghost-cell-${cellIndex}`}
                  className={cn(
                    'min-w-0',
                    cellIndex === row.length - 1 && 'text-right',
                  )}
                >
                  <GhostCellView
                    cell={cell}
                    delay={
                      ROWS_START + rowIndex * ROW_STEP + cellIndex * CELL_STEP
                    }
                    reduced={reduced}
                  />
                </div>
              ))}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
