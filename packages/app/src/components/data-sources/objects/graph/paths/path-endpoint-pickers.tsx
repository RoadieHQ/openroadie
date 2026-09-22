import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { OBJECT_GRAPH_PATHS_MAX_DEPTH } from '../../../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../../../types';
import { ObjectSearchPicker } from '../object-search-picker';
import type { ObjectGraphFocus } from '../object-graph-focus';

const DEPTH_OPTIONS = Array.from(
  { length: OBJECT_GRAPH_PATHS_MAX_DEPTH },
  (_, index) => index + 1,
);

const SHORTEST = 'shortest';

/** The A ↔ B bar of the paths mode: two object pickers, swap, hop limit. */
export function PathEndpointPickers({
  a,
  b,
  hopLimit,
  datasourceIds,
  dataSources,
  onChangeA,
  onChangeB,
  onSwap,
  onHopLimitChange,
}: {
  a: ObjectGraphFocus | null;
  b: ObjectGraphFocus | null;
  /** Explicit "≤ N hops" pick; null = shortest paths only (the default). */
  hopLimit: number | null;
  datasourceIds: readonly string[];
  dataSources: DataSourceItem[];
  onChangeA: (focus: ObjectGraphFocus | null) => void;
  onChangeB: (focus: ObjectGraphFocus | null) => void;
  onSwap: () => void;
  onHopLimitChange: (hopLimit: number | null) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="path-endpoint-pickers"
    >
      <ObjectSearchPicker
        value={a}
        onChange={onChangeA}
        datasourceIds={datasourceIds}
        dataSources={dataSources}
        placeholder="First object…"
        className="w-64"
        aria-label="First path endpoint"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="size-8 shrink-0 p-0"
        aria-label="Swap the two objects"
        disabled={!a && !b}
        onClick={onSwap}
      >
        <ArrowLeftRight className="size-3.5" />
      </Button>
      <ObjectSearchPicker
        value={b}
        onChange={onChangeB}
        datasourceIds={datasourceIds}
        dataSources={dataSources}
        placeholder="Second object…"
        className="w-64"
        aria-label="Second path endpoint"
      />
      <Select
        value={hopLimit === null ? SHORTEST : String(hopLimit)}
        onValueChange={next => {
          if (next === SHORTEST) {
            onHopLimitChange(null);
            return;
          }
          const parsed = Number(next);
          if (Number.isInteger(parsed)) {
            onHopLimitChange(parsed);
          }
        }}
      >
        <SelectTrigger className="h-8 w-36 text-xs" aria-label="Path length">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SHORTEST}>Shortest paths</SelectItem>
          {DEPTH_OPTIONS.map(depth => (
            <SelectItem key={depth} value={String(depth)}>
              ≤ {depth} hop{depth === 1 ? '' : 's'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
