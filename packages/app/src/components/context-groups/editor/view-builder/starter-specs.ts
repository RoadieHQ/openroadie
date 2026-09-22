import type { ContextGroupViewSchema } from '../../../../api/datastore/datastore-client';
import { VIEW_SPEC_VERSION, type ViewSpec } from './types';

export interface ViewStarter {
  id: string;
  title: string;
  description: string;
  /** Absent for the "start from a raw template" option. */
  spec?: ViewSpec;
}

function sourcesWith(
  schema: ContextGroupViewSchema,
  pick: (source: ContextGroupViewSchema['sources'][number]) => string[],
) {
  return schema.sources.map(source => ({
    key: source.key,
    label: source.label,
    fields: pick(source).map(path => ({ path })),
    related: [],
  }));
}

/**
 * The views worth offering before anyone writes a template, seeded from this
 * rule's own fields. The presets come from the backend's field profiling, so
 * "identifiers" and "essentials" mean something specific to each data source
 * rather than being a generic guess.
 */
export function buildStarters(schema: ContextGroupViewSchema): ViewStarter[] {
  const base = { version: VIEW_SPEC_VERSION } as const;

  const starters: ViewStarter[] = [
    {
      id: 'everything',
      title: 'Everything',
      description: 'Every field of every object, as JSON.',
      spec: {
        ...base,
        format: 'json',
        sources: sourcesWith(schema, () => []),
      },
    },
    {
      id: 'identifiers',
      title: 'Identifiers only',
      description:
        'Just the fields that name or address each object — the cheapest way for an agent to see what is in the group.',
      spec: {
        ...base,
        format: 'json',
        sources: sourcesWith(schema, source => source.presets.identifiers),
      },
    },
    {
      id: 'essentials',
      title: 'Essentials',
      description:
        'Identifiers plus names, statuses and other shallow fields worth having.',
      spec: {
        ...base,
        format: 'json',
        sources: sourcesWith(schema, source => source.presets.essentials),
      },
    },
    {
      id: 'briefing',
      title: 'Markdown briefing',
      description:
        'A heading per data source and a bullet per object. Reads well when the agent is summarising rather than looking up fields.',
      spec: {
        ...base,
        format: 'markdown',
        sources: sourcesWith(schema, source => source.presets.essentials),
      },
    },
    {
      id: 'blank',
      title: 'Write the template myself',
      description:
        'Start from a raw Liquid template. You can come back to the builder later.',
    },
  ];

  // A rule whose data sources have no identifier-like fields would offer an
  // "identifiers" view that renders nothing but object ids — drop it rather
  // than show an empty starter.
  return starters.filter(
    starter =>
      starter.id !== 'identifiers' ||
      starter.spec!.sources.some(source => source.fields.length > 0),
  );
}
