import { useState, useCallback, useMemo, useRef } from 'react';
import { z } from 'zod';
import { getWorkspaceStorageScopeKey } from '../../../api/workspace-scope';
import { useMountEffect } from '../../../hooks/use-mount-effect';

const DEBOUNCE_MS = 5000;
const SAVED_DISPLAY_MS = 2000;

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const finiteNumber = z.number().refine(Number.isFinite);

const point = z.object({ x: finiteNumber, y: finiteNumber });

const viewportSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  zoom: finiteNumber,
});

const graphLayoutNodeSchema = z.object({
  id: z.string(),
  datasourceId: z.string(),
  position: point,
  width: finiteNumber.optional(),
});

const graphLayoutEdgeSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

const graphLayoutSchema = z.object({
  nodes: z.array(graphLayoutNodeSchema),
  edges: z.array(graphLayoutEdgeSchema),
  viewport: viewportSchema,
});

export type Viewport = z.infer<typeof viewportSchema>;
export type GraphLayoutNode = z.infer<typeof graphLayoutNodeSchema>;
export type GraphLayoutEdge = z.infer<typeof graphLayoutEdgeSchema>;
export type GraphLayout = z.infer<typeof graphLayoutSchema>;

interface UseGraphLayoutStorageResult {
  savedLayout: GraphLayout | null;
  saveStatus: SaveStatus;
  saveLayout: (
    nodes: GraphLayoutNode[],
    edges: GraphLayoutEdge[],
    viewport: Viewport,
  ) => void;
}

function storageKey(name: string): string {
  return `graph-layout-${name}`;
}

/**
 * localStorage is user-writable, so a stored layout is untrusted input —
 * validate it rather than casting. Anything unparseable is treated as "no
 * saved layout": the graph then auto-arranges and refits, which is a complete
 * fallback, so a stale cache never blocks the editor.
 */
export function parseStoredLayout(raw: string | null): GraphLayout | null {
  if (!raw) {
    return null;
  }
  try {
    return graphLayoutSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function loadLayout(name: string): GraphLayout | null {
  const key = storageKey(name);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage disabled (private mode, blocked cookies) — no layout to restore.
    return null;
  }
  const layout = parseStoredLayout(raw);
  if (raw !== null && layout === null) {
    // Drop the corrupt entry so every later mount doesn't re-parse it.
    try {
      localStorage.removeItem(key);
    } catch {
      // Best-effort cleanup; the parse already failed closed.
    }
  }
  return layout;
}

export function useGraphLayoutStorage(
  name: string,
): UseGraphLayoutStorageResult {
  const workspaceKey = getWorkspaceStorageScopeKey();
  const scopedName =
    workspaceKey === '__organization__' ? name : `${workspaceKey}:${name}`;
  // Read during initialisation, not in an effect: the read is synchronous, so
  // there is no loading phase to render (a one-frame spinner reads as a glitch).
  const savedLayout = useMemo(() => loadLayout(scopedName), [scopedName]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const pendingRef = useRef<{
    nodes: GraphLayoutNode[];
    edges: GraphLayoutEdge[];
    viewport: Viewport;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef(scopedName);
  nameRef.current = scopedName;

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const data = pendingRef.current;
    if (!data) {
      return;
    }
    pendingRef.current = null;
    setSaveStatus('saving');
    try {
      localStorage.setItem(
        storageKey(nameRef.current),
        JSON.stringify({
          nodes: data.nodes,
          edges: data.edges,
          viewport: data.viewport,
        }),
      );
      setSaveStatus('saved');
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus('idle');
      }, SAVED_DISPLAY_MS);
    } catch {
      setSaveStatus('error');
    }
  }, []);

  useMountEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
      const data = pendingRef.current;
      if (data) {
        pendingRef.current = null;
        try {
          localStorage.setItem(
            storageKey(nameRef.current),
            JSON.stringify({
              nodes: data.nodes,
              edges: data.edges,
              viewport: data.viewport,
            }),
          );
        } catch {
          // localStorage may be unavailable or over quota; layout persistence is best-effort.
        }
      }
    };
  });

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const saveLayout = useCallback(
    (
      nodes: GraphLayoutNode[],
      edges: GraphLayoutEdge[],
      viewport: Viewport,
    ) => {
      pendingRef.current = { nodes, edges, viewport };
      setSaveStatus('pending');
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        flushRef.current();
      }, DEBOUNCE_MS);
    },
    [],
  );

  return { savedLayout, saveStatus, saveLayout };
}
