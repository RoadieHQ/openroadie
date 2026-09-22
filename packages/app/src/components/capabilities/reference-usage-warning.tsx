import type { ReferencedTarget } from './reference-usage';
import { formatUsedByNames } from './reference-usage';

const TYPE_NOUN = {
  datasource: 'data source',
  action: 'action',
  'context-group': 'context group',
  capability: 'capability',
} as const;

const TYPE_NOUN_PLURAL = {
  datasource: 'data sources',
  action: 'actions',
  'context-group': 'context groups',
  capability: 'capabilities',
} as const;

export interface ReferenceUsageWarningProps {
  /** Targets something references — from `useReferenceUsage`. */
  referenced: ReferencedTarget[];
  /** `loading` from `useReferenceUsage`. */
  loading: boolean;
  /** Whether more than one thing is being deleted, for the plural copy. */
  multiple?: boolean;
}

/**
 * Warns that deleting these resources will leave capabilities with broken
 * `@type:slug` references.
 *
 * Renders inside `ConfirmationDialog`'s `contentText`, which is a
 * `DialogDescription` (a `<p>`) — so every element here is a `<span>`, never a
 * `<div>`. Advisory only: it never blocks the confirm.
 */
export function ReferenceUsageWarning({
  referenced,
  loading,
  multiple = false,
}: ReferenceUsageWarningProps) {
  if (loading) {
    return (
      <span className="mt-3 block text-sm text-muted-foreground">
        Checking which capabilities reference this…
      </span>
    );
  }

  if (referenced.length === 0) return null;

  const singular = referenced.length === 1 && !multiple;
  const noun = singular
    ? TYPE_NOUN[referenced[0].type]
    : TYPE_NOUN_PLURAL[referenced[0].type];

  return (
    <span
      data-testid="reference-usage-warning"
      className="mt-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning"
    >
      <span className="font-medium">
        {singular
          ? `This ${noun} is referenced by capabilities:`
          : `Some of these ${noun} are referenced by capabilities:`}
      </span>
      {referenced.map(entry => (
        <span key={`${entry.type}:${entry.slug}`}>
          <span className="font-medium">{entry.name}</span> — used by{' '}
          {formatUsedByNames(entry.usedBy.map(c => c.name))}
        </span>
      ))}
      <span>
        Deleting will leave those capabilities with broken references.
      </span>
    </span>
  );
}
