import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

export interface GhostGraphNode {
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  x: number;
  y: number;
}

export interface GhostGraphEdge {
  source: string;
  target: string;
}

export interface GhostGraphPreviewProps {
  nodes: readonly GhostGraphNode[];
  edges: readonly GhostGraphEdge[];
}

const NODE_START = 0.2;
const NODE_STEP = 0.28;
const EDGE_STEP = 0.22;

export function ghostGraphSettleAt(nodeCount: number, edgeCount: number) {
  return NODE_START + nodeCount * NODE_STEP + edgeCount * EDGE_STEP + 0.5;
}

export function GhostGraphPreview({
  nodes,
  edges,
}: GhostGraphPreviewProps): JSX.Element {
  const reduced = useReducedMotion() ?? false;
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const edgeStart = NODE_START + nodes.length * NODE_STEP;
  const settleDelay = ghostGraphSettleAt(nodes.length, edges.length);

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none relative h-56 overflow-hidden rounded-lg border border-dashed border-border bg-muted/20 select-none"
      initial={reduced ? { opacity: 0.4 } : { opacity: 1 }}
      animate={{ opacity: 0.4 }}
      transition={{ delay: settleDelay, duration: 0.6 }}
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {edges.map((edge, index) => {
          const source = nodesById.get(edge.source);
          const target = nodesById.get(edge.target);
          if (!source || !target) return null;

          return (
            <motion.line
              key={`${edge.source}-${edge.target}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              className="text-primary"
              initial={reduced ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{
                delay: edgeStart + index * EDGE_STEP,
                duration: 0.45,
              }}
            />
          );
        })}
      </svg>

      {nodes.map((node, index) => {
        const Icon = node.icon;
        return (
          <motion.div
            key={node.id}
            className="absolute flex w-40 -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
            initial={reduced ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: NODE_START + index * NODE_STEP,
              duration: 0.35,
            }}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-medium text-foreground">
                {node.label}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {node.detail}
              </span>
            </span>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
