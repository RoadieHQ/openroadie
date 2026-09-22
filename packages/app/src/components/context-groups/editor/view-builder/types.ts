import { z } from 'zod';

/** Bumped when a spec change stops old markers from compiling to the same
 *  template. A marker with an unknown version fails to parse, which drops the
 *  view into advanced mode rather than silently rewriting it. */
export const VIEW_SPEC_VERSION = 1;

export const VIEW_FORMATS = ['json', 'markdown', 'text'] as const;
export type ViewFormat = (typeof VIEW_FORMATS)[number];

/** One field of a member's object, emitted under `label` (defaulted from the
 *  path's leaf segment when absent). */
export interface ViewField {
  path: string;
  label?: string;
}

/** Objects reachable from a member via one outgoing relationship type,
 *  emitted alongside it. Compiles to the `related` data function. */
export interface ViewRelated {
  type: string;
  fields: ViewField[];
  limit?: number;
}

/** One data source of the rule, addressed by its document key
 *  (`members.<key>`). A source absent from the spec is absent from the view. */
export interface ViewSource {
  key: string;
  label: string;
  /** Empty means the whole object — the view emits `data` verbatim. */
  fields: ViewField[];
  related: ViewRelated[];
  limit?: number;
}

export interface ViewSpec {
  version: typeof VIEW_SPEC_VERSION;
  format: ViewFormat;
  sources: ViewSource[];
}

const fieldSchema = z.object({
  path: z.string().min(1),
  label: z.string().optional(),
});

const relatedSchema = z.object({
  type: z.string().min(1),
  fields: z.array(fieldSchema),
  limit: z.number().int().positive().optional(),
});

export const viewSpecSchema = z.object({
  version: z.literal(VIEW_SPEC_VERSION),
  format: z.enum(VIEW_FORMATS),
  sources: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string(),
      fields: z.array(fieldSchema),
      related: z.array(relatedSchema),
      limit: z.number().int().positive().optional(),
    }),
  ),
});

export const EMPTY_VIEW_SPEC: ViewSpec = {
  version: VIEW_SPEC_VERSION,
  format: 'json',
  sources: [],
};
