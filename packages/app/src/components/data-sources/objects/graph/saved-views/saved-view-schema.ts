import { z } from 'zod';
import {
  SAVED_GRAPH_VIEW_ICON_KEYS,
  type SavedGraphViewIconKey,
} from './saved-view-icons';

export const SAVED_VIEW_NAME_MAX = 60;

const cameraSchema = z.object({
  x: z.number(),
  y: z.number(),
  k: z.number(),
});

/** One named snapshot: the page's URL params plus the state the URL can't
 * carry — the object view's expansions and the camera. */
export const savedGraphViewSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(SAVED_VIEW_NAME_MAX),
  createdAt: z.string(),
  /** The exact URL param map (`view`, `ds`, `q`, `types`,
   * `focus`, `depth`, `dir`, `a`, `b`, `pathDepth`). */
  params: z.record(z.string(), z.string()),
  objectState: z
    .object({
      expandedKeys: z.array(z.string()),
      revealCounts: z.record(z.string(), z.number()),
    })
    .optional(),
  camera: cameraSchema.nullable(),
  iconKey: z.enum(SAVED_GRAPH_VIEW_ICON_KEYS).optional(),
});

export type SavedGraphView = z.infer<typeof savedGraphViewSchema>;
export type { SavedGraphViewIconKey };

/** Versioned storage envelope — unknown versions/garbage fall back empty. */
export const savedGraphViewsFileSchema = z.object({
  version: z.literal(1),
  views: z.array(savedGraphViewSchema),
});

export type SavedGraphViewsFile = z.infer<typeof savedGraphViewsFileSchema>;

export const EMPTY_SAVED_VIEWS_FILE: SavedGraphViewsFile = {
  version: 1,
  views: [],
};

export const saveViewFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(
      SAVED_VIEW_NAME_MAX,
      `Keep it under ${SAVED_VIEW_NAME_MAX} characters`,
    ),
});

export type SaveViewFormValues = z.infer<typeof saveViewFormSchema>;
