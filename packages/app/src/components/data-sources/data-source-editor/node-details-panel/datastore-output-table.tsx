import React, { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { CopyButton } from '@roadiehq/ui/copy-button';
import { cn } from '@roadiehq/ui/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roadiehq/ui/table';

const ROW_PREVIEW_LIMIT = 20;

interface DatastoreOutputTableProps {
  rows: unknown[];
  fillHeight?: boolean;
  toolbarLeft?: React.ReactNode;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function escapeCsv(raw: unknown): string {
  const str = formatCell(raw);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function readCell(row: unknown, col: string): unknown {
  if (!row || typeof row !== 'object') {
    return undefined;
  }
  return (row as Record<string, unknown>)[`${col}`];
}

function toCsv(rows: unknown[], columns: string[]): string {
  const header = columns.map(escapeCsv).join(',');
  const body = rows.map(row =>
    columns.map(col => escapeCsv(readCell(row, col))).join(','),
  );
  return [header, ...body].join('\n');
}

export function DatastoreOutputTable({
  rows,
  fillHeight = false,
  toolbarLeft,
}: DatastoreOutputTableProps) {
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const columns = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const row of rows.slice(0, ROW_PREVIEW_LIMIT)) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        for (const key of Object.keys(row as Record<string, unknown>)) {
          if (!seen.has(key)) {
            seen.add(key);
            ordered.push(key);
          }
        }
      }
    }
    return ordered;
  }, [rows]);

  const visibleRows = rows.slice(0, ROW_PREVIEW_LIMIT);
  const overflow = Math.max(0, rows.length - ROW_PREVIEW_LIMIT);

  const isEmpty = rows.length === 0;

  return (
    <div className={cn('flex flex-col', fillHeight && 'h-full min-h-0 flex-1')}>
      <div className="flex items-center justify-between bg-white/[0.02] py-1 dark:bg-white/[0.02]">
        <div className="flex items-center gap-2">
          {toolbarLeft}
          <span className="text-xs text-muted-foreground">
            {rows.length} row{rows.length === 1 ? '' : 's'}
          </span>
        </div>
        {!isEmpty && (
          <CopyButton value={() => toCsv(rows, columns)} label="Copy CSV" />
        )}
      </div>

      {isEmpty ? (
        <div
          className={cn(
            'mt-2 flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6',
            fillHeight && 'min-h-0 flex-1',
          )}
        >
          <p className="text-xs text-muted-foreground">
            No output yet. Run the pipeline to see rows.
          </p>
        </div>
      ) : (
        <>
          <div
            className={cn(
              'mt-2 rounded-md border border-border bg-muted/30',
              fillHeight && 'min-h-0 flex-1 overflow-auto',
            )}
          >
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 w-6 px-1" />
                  {columns.map(col => (
                    <TableHead
                      key={col}
                      className="h-8 px-2 font-mono text-xs whitespace-nowrap"
                    >
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row, idx) => {
                  const isExpanded = expandedRows.has(idx);
                  return (
                    <Fragment key={idx}>
                      <TableRow>
                        <TableCell className="w-6 px-1 py-1.5 align-top">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleRow(idx)}
                            className="size-5 text-muted-foreground"
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded ? 'Collapse row' : 'Expand row'
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                          </Button>
                        </TableCell>
                        {columns.map(col => {
                          const cell = formatCell(readCell(row, col));
                          return (
                            <TableCell
                              key={col}
                              className="max-w-[320px] truncate px-2 py-1.5 font-mono text-xs"
                              title={cell}
                            >
                              {cell}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell
                            colSpan={columns.length + 1}
                            className="bg-muted/40 px-2 py-2"
                          >
                            <pre className="overflow-auto font-mono text-xs leading-5 whitespace-pre">
                              {JSON.stringify(row, null, 2)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {overflow > 0 && (
            <p className="text-xs text-muted-foreground">
              +{overflow} more row{overflow === 1 ? '' : 's'} will be written
            </p>
          )}
        </>
      )}
    </div>
  );
}
