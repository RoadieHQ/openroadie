import type { ComponentType } from 'react';
import { Link } from 'react-router';
import type { Components } from 'react-markdown';
import { Database, Zap, Boxes, Sparkles, HelpCircle } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import {
  type CapabilityReference,
  type CapabilityReferenceType,
  referenceKey,
} from './references';
import {
  actionDetail,
  capabilityDetail,
  contextGroupEdit,
  dataSourceDetail,
} from '../../../config/paths';

const TYPE_ICON = new Map<
  CapabilityReferenceType,
  ComponentType<{ className?: string }>
>([
  ['datasource', Database],
  ['action', Zap],
  ['context-group', Boxes],
  ['capability', Sparkles],
]);

const TYPE_PATH: Record<CapabilityReferenceType, (id: string) => string> = {
  datasource: dataSourceDetail,
  action: actionDetail,
  'context-group': contextGroupEdit,
  capability: capabilityDetail,
};

function isReferenceType(value: unknown): value is CapabilityReferenceType {
  return (
    value === 'datasource' ||
    value === 'action' ||
    value === 'context-group' ||
    value === 'capability'
  );
}

function ReferencePill({
  reftype,
  slug,
  byKey,
}: {
  reftype: CapabilityReferenceType;
  slug: string;
  byKey: Map<string, CapabilityReference>;
}) {
  const Icon = TYPE_ICON.get(reftype) ?? HelpCircle;
  const resolved = byKey.get(referenceKey(reftype, slug));
  const label = resolved?.name ?? slug;

  const inner = (
    <>
      {resolved ? (
        <Icon className="size-3" />
      ) : (
        <HelpCircle className="size-3" />
      )}
      {label}
    </>
  );

  const baseClassName =
    'mx-0.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 align-baseline text-xs font-medium no-underline';

  if (!resolved) {
    return (
      <span
        className={cn(
          baseClassName,
          'border-dashed border-muted-foreground/40 text-muted-foreground',
        )}
        title={`Unknown ${reftype}: ${slug}`}
      >
        {inner}
      </span>
    );
  }

  return (
    <Link
      to={TYPE_PATH[`${reftype}`](resolved.id)}
      target="_blank"
      rel="noopener noreferrer"
      data-capability-reference="true"
      className={cn(
        baseClassName,
        'border-primary/20 bg-primary/10 text-primary hover:bg-primary/20',
      )}
      title={`${reftype}: ${slug}`}
    >
      {inner}
    </Link>
  );
}

/**
 * Build the react-markdown `components` map that renders `@type:slug` reference
 * tokens (turned into marked `<span>`s by `remarkCapabilityReferences`) as
 * labelled pills. Closes over the reference lookup to resolve display names and
 * flag dangling references.
 */
export function makeCapabilityReferenceComponents(
  byKey: Map<string, CapabilityReference>,
): Components {
  return {
    span({ node, children, ...props }) {
      const properties = node?.properties ?? {};
      if (properties.dataCapabilityReference === 'true') {
        const reftype = properties.reftype;
        const slug = properties.slug;
        if (isReferenceType(reftype) && typeof slug === 'string') {
          return <ReferencePill reftype={reftype} slug={slug} byKey={byKey} />;
        }
      }
      return <span {...props}>{children}</span>;
    },
  };
}
