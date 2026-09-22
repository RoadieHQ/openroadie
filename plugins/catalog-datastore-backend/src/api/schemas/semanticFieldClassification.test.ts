import { describe, expect, it } from 'vitest';
import {
  classifyRelationshipFieldSemantic,
  semanticCompatibility,
} from './semanticFieldClassification';

describe('classifyRelationshipFieldSemantic', () => {
  it.each([
    ['$.email', undefined, 'email'],
    ['$.spec.email_address', undefined, 'email'],
    ['$.value', 'corp email directory', 'email'],
    ['$.username', undefined, 'person'],
    ['$.spec.display_name', undefined, 'person'],
    ['$.name', 'GitHub users', 'person'],
    ['$.role', undefined, 'classification'],
    ['$.status', undefined, 'classification'],
    ['$.value', 'okta permissions', 'classification'],
    ['$.id', 'tenant directory', 'tenant'],
    ['$.value', 'k8s namespaces', 'namespace'],
    ['$.kubernetes_pod_name', undefined, 'service'],
    ['$.value', 'GitHub repos', 'project'],
    ['$.value', 'GitHub teams', 'team'],
    ['$.value', 'rds inventory', 'database'],
    ['$.region', undefined, 'environment'],
    ['$.cluster', undefined, 'environment'],
    ['$.account_id', undefined, 'environment'],
    ['$.id', undefined, 'resource_id'],
    ['$.arn', undefined, 'resource_id'],
    ['$.foo', undefined, 'unknown'],
  ] as const)(
    'classifies %s (datasource: %s) as %s',
    (fieldPath, datasourceName, expected) => {
      expect(classifyRelationshipFieldSemantic(fieldPath, datasourceName)).toBe(
        expected,
      );
    },
  );

  it('does not treat $.name on a non-user datasource as person', () => {
    expect(
      classifyRelationshipFieldSemantic('$.name', 'kubernetes services'),
    ).not.toBe('person');
  });
});

describe('semanticCompatibility', () => {
  it('returns weak-domain when either side is unknown', () => {
    expect(semanticCompatibility('unknown', 'email')).toBe('weak-domain');
    expect(semanticCompatibility('email', 'unknown')).toBe('weak-domain');
  });

  it('returns same-domain when both sides match', () => {
    expect(semanticCompatibility('email', 'email')).toBe('same-domain');
    expect(semanticCompatibility('person', 'person')).toBe('same-domain');
  });

  it('returns related-domain for the person/email pair (both orders)', () => {
    expect(semanticCompatibility('person', 'email')).toBe('related-domain');
    expect(semanticCompatibility('email', 'person')).toBe('related-domain');
  });

  it.each([
    ['service', 'namespace'],
    ['service', 'project'],
    ['project', 'team'],
    ['database', 'tenant'],
    ['database', 'resource_id'],
  ] as const)('returns related-domain for %s ↔ %s', (a, b) => {
    expect(semanticCompatibility(a, b)).toBe('related-domain');
    expect(semanticCompatibility(b, a)).toBe('related-domain');
  });

  it('returns mismatch when classification appears with a different domain', () => {
    expect(semanticCompatibility('classification', 'service')).toBe('mismatch');
  });

  it('returns mismatch when environment appears with a different domain', () => {
    expect(semanticCompatibility('environment', 'service')).toBe('mismatch');
  });

  it('returns weak-domain for a known-but-unpaired domain combination (fixed fallthrough)', () => {
    expect(semanticCompatibility('tenant', 'service')).toBe('weak-domain');
  });
});
