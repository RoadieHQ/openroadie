import type {
  RelationshipSuggestionFieldSemantic,
  RelationshipSuggestionSemanticCompatibility,
} from '@roadiehq/catalog-datastore-common';
import { pathSegments } from '../_shared';

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function hasAny(value: string, terms: string[]): boolean {
  const normalized = normalize(value);
  return terms.some(term => normalized.includes(term));
}

function hasSegment(field: string, terms: string[]): boolean {
  const segments = pathSegments(field);
  return segments.some(segment => terms.includes(segment));
}

export function classifyRelationshipFieldSemantic(
  field: string,
  datasourceName?: string,
): RelationshipSuggestionFieldSemantic {
  const combined = `${datasourceName ?? ''} ${field}`;
  const datasourceText = datasourceName ?? '';
  const isUserLikeDatasource = hasAny(datasourceText, [
    'user',
    'users',
    'person',
    'people',
    'employee',
    'employees',
    'member',
    'members',
  ]);

  if (
    hasSegment(field, ['email', 'email_address', 'mail']) ||
    hasAny(combined, ['email', 'email address'])
  ) {
    return 'email';
  }
  if (
    hasSegment(field, [
      'username',
      'user_name',
      'login',
      'mention_name',
      'full_name',
      'fullname',
      'display_name',
      'displayname',
    ]) ||
    (isUserLikeDatasource && hasSegment(field, ['name'])) ||
    hasAny(combined, ['github users', 'sentry users', 'shortcut users'])
  ) {
    return 'person';
  }
  if (
    hasSegment(field, ['role', 'roles', 'state', 'status', 'type', 'kind']) ||
    hasAny(combined, ['permission', 'visibility'])
  ) {
    return 'classification';
  }
  if (hasAny(combined, ['tenant', 'organization'])) {
    return 'tenant';
  }
  if (hasAny(combined, ['namespace', 'k8s namespaces'])) {
    return 'namespace';
  }
  if (
    hasAny(combined, [
      'service_name',
      'service label',
      'backend_services',
      'deployment_name',
      'ingress_name',
      'kubernetes_pod_name',
      ' pod',
      'service ',
      'deployment',
      'ingress',
    ])
  ) {
    return 'service';
  }
  if (
    hasAny(combined, [
      'project_slugs',
      'project slug',
      'sentry project',
      'github repos',
      'repo',
      'repository',
    ])
  ) {
    return 'project';
  }
  if (hasAny(combined, ['github teams', 'sentry team', 'team members'])) {
    return 'team';
  }
  if (hasAny(combined, ['rds', 'database', 'dbname', 'dbinstance'])) {
    return 'database';
  }
  if (
    hasSegment(field, [
      'region',
      'account_id',
      'accountid',
      'cluster',
      'env',
      'environment',
    ])
  ) {
    return 'environment';
  }
  if (
    hasSegment(field, ['id', 'node_id', 'resource_id', 'endpoint']) ||
    hasAny(combined, ['arn', 'resource'])
  ) {
    return 'resource_id';
  }
  return 'unknown';
}

export function semanticCompatibility(
  source: RelationshipSuggestionFieldSemantic,
  target: RelationshipSuggestionFieldSemantic,
): RelationshipSuggestionSemanticCompatibility {
  if (source === 'unknown' || target === 'unknown') {
    return 'weak-domain';
  }
  if (source === target) {
    return 'same-domain';
  }
  const pair = new Set([source, target]);
  if (pair.has('person') && pair.has('email')) {
    return 'related-domain';
  }
  if (
    (pair.has('service') && pair.has('namespace')) ||
    (pair.has('service') && pair.has('project')) ||
    (pair.has('project') && pair.has('team')) ||
    (pair.has('database') && pair.has('tenant')) ||
    (pair.has('database') && pair.has('resource_id'))
  ) {
    return 'related-domain';
  }
  if (pair.has('classification') || pair.has('environment')) {
    return 'mismatch';
  }
  // Any other known-but-unpaired combination (e.g. person ↔ database) has no
  // explicit evidence either way — weak-domain (not mismatch), so callers
  // that only penalize genuine incompatibility (signalScoring's
  // semantic-incompatible) don't fire on pairs nobody has actually reasoned
  // about.
  return 'weak-domain';
}
