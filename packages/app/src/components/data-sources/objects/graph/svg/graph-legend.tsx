export interface GraphLegendEntry {
  id: string;
  name: string;
  color: string;
  count?: number;
}

/** The kit's bottom-left datasource legend (color swatch, name, count). */
export function GraphLegend({ entries }: { entries: GraphLegendEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="absolute bottom-3 left-3 flex max-w-[46%] flex-col gap-1 rounded-lg border border-border bg-card/90 px-2.5 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-[2px]">
      {entries.map(entry => (
        <div key={entry.id} className="flex items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="min-w-0 truncate">{entry.name}</span>
          {entry.count !== undefined && (
            <span className="ml-auto pl-2 tabular-nums">{entry.count}</span>
          )}
        </div>
      ))}
    </div>
  );
}
