import { Panel } from '@xyflow/react';
import { Card } from '@roadiehq/ui/card';
import { humanizeRelationshipType } from '../humanize-relationship-type';

export interface GraphLegendItem {
  type: string;
  color: string;
  /** Matches the edge's stroke dash pattern (undefined = solid). */
  dashPattern?: string;
}

export function GraphLegend({ items }: { items: GraphLegendItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Panel position="top-right">
      <Card variant="floating" className="max-h-[60vh] overflow-y-auto p-2">
        <div className="mb-1.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          Relationships
        </div>
        <ul className="flex flex-col gap-1">
          {items.map(item => (
            <li
              key={item.type}
              className="flex items-center gap-2 text-xs text-foreground"
            >
              <svg
                aria-hidden
                width="20"
                height="6"
                viewBox="0 0 20 6"
                className="shrink-0"
              >
                <line
                  x1="0"
                  y1="3"
                  x2="20"
                  y2="3"
                  stroke={item.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={item.dashPattern}
                />
              </svg>
              <span className="truncate" title={item.type}>
                {humanizeRelationshipType(item.type)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Panel>
  );
}
