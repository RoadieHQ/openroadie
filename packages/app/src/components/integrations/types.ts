import type { BaseItem } from '@roadiehq/ui/item-list';
import {
  Activity,
  BarChart3,
  Boxes,
  Code,
  KanbanSquare,
  MessagesSquare,
  Server,
  ShieldCheck,
  Siren,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { IntegrationAuthType } from '../../api/workflow/integration-auth-types';

export type { IntegrationAuthType };

export interface GithubAppInfo {
  appId: string;
  host: string;
  purposes?: string[];
  slug?: string;
  htmlUrl?: string;
  description?: string;
  privateKeyRef?: string;
  clientSecretRef?: string;
  kmsKeyId?: string;
}

export interface Integration {
  id: string;
  name: string;
  slug: string;
  type: string;
  host: string;
  backendType: 'http' | 'aws';
  authType: IntegrationAuthType;
  authConfig?: Record<string, unknown> | null;
  requestsPerHour?: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  config: Record<string, unknown>;
  readyForCurrentScope?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  logoUrl: string;
  logoSlug?: string;
  graphqlPath?: string | null;
  extensions?: {
    githubApps?: GithubAppInfo[];
    [key: string]: unknown;
  };
}

/** A minimal reference to something that uses an integration. */
export interface EntityRef {
  id: string;
  name: string;
}

export interface WorkflowRef {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  enabled?: boolean;
  nodeCount?: number;
}

export interface IntegrationItem extends BaseItem {
  slug: string;
  type: string;
  host: string;
  backendType: 'http' | 'aws';
  authType: IntegrationAuthType;
  authConfig?: Record<string, unknown> | null;
  requestsPerHour?: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  config: Record<string, unknown>;
  readyForCurrentScope?: boolean;
  createdBy: string;
  createdAt: string;
  referencingWorkflows: WorkflowRef[];
  /** Actions with a step configured against this integration. */
  referencingActions: EntityRef[];
  /** Integration-backed relationship rules configured against it. */
  referencingRelationshipRules: EntityRef[];
  logoSlug?: string;
  graphqlPath?: string | null;
  extensions?: {
    githubApps?: GithubAppInfo[];
    [key: string]: unknown;
  };
}

export const INTEGRATION_TYPE_META: Record<
  string,
  { label: string; icon: string; color: string; logoSlug: string }
> = {
  scm: {
    label: 'Source Control',
    icon: 'data',
    color: '#8b5cf6',
    logoSlug: 'code',
  },
  'ci-cd': {
    label: 'CI / CD',
    icon: 'webhook',
    color: '#f97316',
    logoSlug: 'pipeline',
  },
  monitoring: {
    label: 'Monitoring',
    icon: 'api',
    color: '#22c55e',
    logoSlug: 'monitor',
  },
  'incident-management': {
    label: 'Incident Management',
    icon: 'hub',
    color: '#ef4444',
    logoSlug: 'alert',
  },
  infrastructure: {
    label: 'Infrastructure',
    icon: 'cloud',
    color: '#3b82f6',
    logoSlug: 'server',
  },
  security: {
    label: 'Security',
    icon: 'api',
    color: '#ca8a04',
    logoSlug: 'shield',
  },
  communication: {
    label: 'Communication',
    icon: 'hub',
    color: '#14b8a6',
    logoSlug: 'chat',
  },
  'project-management': {
    label: 'Project Management',
    icon: 'webhook',
    color: '#7c3aed',
    logoSlug: 'ticket',
  },
  analytics: {
    label: 'Analytics',
    icon: 'data',
    color: '#0ea5e9',
    logoSlug: 'chart',
  },
  other: {
    label: 'Other',
    icon: 'integration',
    color: '#6b7280',
    logoSlug: 'settings',
  },
};

/**
 * Bundled lucide icon per integration category. Used by the sidebar sub-items so
 * the fixed category glyphs render instantly from the bundle — no dependency on
 * the async logo catalog (`listLogos`). Keys mirror {@link INTEGRATION_TYPE_META}.
 */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  scm: Code,
  'ci-cd': Workflow,
  monitoring: Activity,
  'incident-management': Siren,
  infrastructure: Server,
  security: ShieldCheck,
  communication: MessagesSquare,
  'project-management': KanbanSquare,
  analytics: BarChart3,
  other: Boxes,
};

export function toIntegrationItem(
  integration: Integration,
  referencingWorkflows: WorkflowRef[],
  logoDataUriBySlug?: Map<string, string>,
  referencingActions: EntityRef[] = [],
  referencingRelationshipRules: EntityRef[] = [],
): IntegrationItem {
  const meta =
    INTEGRATION_TYPE_META[integration.type] ?? INTEGRATION_TYPE_META.other;
  const categoryLogoUrl = logoDataUriBySlug?.get(meta.logoSlug) ?? '';
  const hasOwnInlineLogo = integration.logoUrl.startsWith('data:');
  const logoUrl =
    integration.createdBy !== 'system' && !hasOwnInlineLogo && categoryLogoUrl
      ? categoryLogoUrl
      : integration.logoUrl;
  return {
    id: integration.id,
    name: integration.name,
    slug: integration.slug,
    type: integration.type,
    host: integration.host,
    backendType: integration.backendType,
    authType: integration.authType,
    authConfig: integration.authConfig,
    requestsPerHour: integration.requestsPerHour,
    requestsPerSecond: integration.requestsPerSecond,
    burstCapacity: integration.burstCapacity,
    config: integration.config,
    readyForCurrentScope: integration.readyForCurrentScope,
    createdBy: integration.createdBy,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    description: integration.host || undefined,
    icon: meta.icon,
    color: meta.color,
    logoUrl,
    logoSlug: integration.logoSlug,
    referencingWorkflows,
    referencingActions,
    referencingRelationshipRules,
    graphqlPath: integration.graphqlPath ?? null,
    extensions: integration.extensions,
  };
}

export function isGitHubAppIntegration(item: {
  slug?: string;
  host?: string;
  extensions?: unknown;
}): boolean {
  if (
    item.extensions &&
    typeof item.extensions === 'object' &&
    (item.extensions as { githubApps?: unknown[] }).githubApps?.length
  ) {
    return true;
  }

  return item.slug === 'github-app' || item.slug === 'github-enterprise-app';
}
