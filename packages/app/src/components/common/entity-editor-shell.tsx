import * as React from 'react';
import { Blocks, Sparkles, Users, Zap, type LucideIcon } from 'lucide-react';
import {
  EditorHeader,
  type EditorHeaderProps,
} from '@roadiehq/ui/editor-header';
import { IntegrationIconFrame, IntegrationLogo } from '@roadiehq/ui/item-list';
import { cn } from '@roadiehq/ui/utils';
import { PATHS } from '../../config/paths';

const HEADER_LOGO_SIZE = 24;
const HEADER_SECTION_ICON_CLASS = 'size-6 shrink-0 text-primary';

type EntityEditorSectionConfig = {
  breadcrumb: string;
  breadcrumbPath: string;
  backTo: string;
  /** Overview/nav icon when this section has no integration logo. */
  Icon?: LucideIcon;
};

const ENTITY_EDITOR_SECTIONS = {
  'data-sources': {
    breadcrumb: 'Data Sources',
    breadcrumbPath: PATHS.DATA_SOURCES,
    backTo: PATHS.DATA_SOURCES,
  },
  integrations: {
    breadcrumb: 'Integrations',
    breadcrumbPath: PATHS.INTEGRATIONS,
    backTo: PATHS.INTEGRATIONS,
    Icon: Blocks,
  },
  actions: {
    breadcrumb: 'Actions',
    breadcrumbPath: PATHS.ACTIONS,
    backTo: PATHS.ACTIONS,
    Icon: Zap,
  },
  capabilities: {
    breadcrumb: 'Capabilities',
    breadcrumbPath: PATHS.CAPABILITIES,
    backTo: PATHS.CAPABILITIES,
    Icon: Sparkles,
  },
  'context-groups': {
    breadcrumb: 'Context Groups',
    breadcrumbPath: PATHS.CONTEXT_GROUPS,
    backTo: PATHS.CONTEXT_GROUPS,
    Icon: Users,
  },
} as const satisfies Record<string, EntityEditorSectionConfig>;

export type EntityEditorSection = keyof typeof ENTITY_EDITOR_SECTIONS;

export type EntityEditorHeaderProps = Omit<
  EditorHeaderProps,
  'breadcrumb' | 'breadcrumbPath' | 'icon'
> & {
  section: EntityEditorSection;
  /** Integration logo URL; when set, renders the provider logo in the header well. */
  logoUrl?: string;
};

function EntityEditorHeaderIcon({
  logoUrl,
  SectionIcon,
}: {
  logoUrl?: string;
  SectionIcon?: LucideIcon;
}) {
  const useLogo = logoUrl !== undefined || !SectionIcon;

  return (
    <IntegrationIconFrame size="row">
      {useLogo ? (
        <IntegrationLogo src={logoUrl ?? ''} size={HEADER_LOGO_SIZE} />
      ) : (
        <SectionIcon className={HEADER_SECTION_ICON_CLASS} />
      )}
    </IntegrationIconFrame>
  );
}

/** Shared editor rail for entity create/edit routes (breadcrumb + back + icon + title). */
export function EntityEditorHeader({
  section,
  logoUrl,
  backTo,
  ...props
}: EntityEditorHeaderProps) {
  const config: EntityEditorSectionConfig =
    ENTITY_EDITOR_SECTIONS[`${section}`];

  return (
    <EditorHeader
      {...props}
      backTo={backTo ?? config.backTo}
      breadcrumb={config.breadcrumb}
      breadcrumbPath={config.breadcrumbPath}
      icon={
        <EntityEditorHeaderIcon logoUrl={logoUrl} SectionIcon={config.Icon} />
      }
    />
  );
}

/** Shared full-page shell for entity create/edit routes. Takes a `ref` (React
 *  19 passes it through as a prop) for routes that portal a drawer into it. */
export function EntityEditorShell({
  className,
  ...props
}: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background',
        className,
      )}
      {...props}
    />
  );
}

/** Narrow centered scroll region used by form-style entity editors. */
export const EntityEditorFormBody = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(function EntityEditorFormBody({ className, ...props }, ref) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={ref}
        className={cn(
          'mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col overflow-y-auto px-6 py-6',
          className,
        )}
        {...props}
      />
    </div>
  );
});
