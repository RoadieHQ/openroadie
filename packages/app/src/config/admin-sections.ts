import { useMemo, type ComponentType } from 'react';
import {
  Building2,
  KeyRound,
  ScrollText,
  Server,
  Sparkles,
  UsersRound,
  Webhook,
} from 'lucide-react';
import { PATHS } from './paths';
import { useFeatureFlag } from '../api';
import { adminSectionExtensions } from '~admin-section-extensions';

export type AdminSection = {
  value: string;
  label: string;
  path: string;
  // Accepts both lucide icons (built-ins) and an overlay extension's icon.
  icon: ComponentType<{ className?: string }>;
};

const ALL_ADMIN_SECTIONS: readonly AdminSection[] = [
  // First: a workspace contains everything the other sections configure.
  {
    value: 'workspaces',
    label: 'Workspaces',
    path: PATHS.ADMIN_WORKSPACES,
    icon: Building2,
  },
  {
    value: 'teams',
    label: 'Teams',
    path: PATHS.ADMIN_TEAMS,
    icon: UsersRound,
  },
  {
    value: 'secrets',
    label: 'Secrets',
    path: PATHS.ADMIN_SECRETS,
    icon: KeyRound,
  },
  {
    value: 'ai-providers',
    label: 'AI Providers',
    path: PATHS.ADMIN_AI_PROVIDERS,
    icon: Sparkles,
  },
  {
    value: 'webhooks',
    label: 'Webhooks',
    path: PATHS.ADMIN_WEBHOOKS,
    icon: Webhook,
  },
  {
    value: 'mcp-servers',
    label: 'MCP Servers',
    path: PATHS.ADMIN_MCP_SERVERS,
    icon: Server,
  },
  {
    value: 'mcp-audit-log',
    label: 'MCP Audit Log',
    path: PATHS.ADMIN_MCP_AUDIT_LOG,
    icon: ScrollText,
  },
] as const;

export function useAdminSections(): readonly AdminSection[] {
  const { value: webhooksEnabled } = useFeatureFlag('webhooks', false);
  const { value: aiProvidersEnabled } = useFeatureFlag('ai-providers', false);

  return useMemo(() => {
    const builtins = ALL_ADMIN_SECTIONS.filter(section => {
      if (section.value === 'webhooks' && !webhooksEnabled) return false;
      if (section.value === 'ai-providers' && !aiProvidersEnabled) return false;
      return true;
    });
    // Deployment overlays append their sections after the built-ins.
    const extensions = adminSectionExtensions.map(
      ({ value, label, path, icon }): AdminSection => ({
        value,
        label,
        path,
        icon,
      }),
    );
    return [...builtins, ...extensions];
  }, [webhooksEnabled, aiProvidersEnabled]);
}
