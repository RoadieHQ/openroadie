import { describe, it, expect } from 'vitest';
import {
  API_VERSION,
  slugify,
  toYaml,
  fromYaml,
  manifestPath,
  secretRefsIn,
} from './format';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('GitHub Repos (org)')).toBe('github-repos-org');
  });

  it('is idempotent on existing slugs', () => {
    expect(slugify('github-repos')).toBe('github-repos');
  });
});

describe('yaml round-trip', () => {
  it('preserves a manifest structurally', () => {
    const manifest = {
      apiVersion: API_VERSION,
      kind: 'DataSource',
      metadata: { slug: 'github-repos', name: 'GitHub Repos' },
      spec: { nodes: [{ id: 'n1', data: { config: { path: '/repos' } } }] },
    };
    expect(fromYaml(toYaml(manifest))).toEqual(manifest);
  });
});

describe('secretRefsIn', () => {
  it('finds refs nested anywhere in a value', () => {
    expect(
      secretRefsIn({ headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' } }),
    ).toEqual(['GITHUB_TOKEN']);
  });

  it('accepts every ref the server accepts, not just A-Z0-9_', () => {
    // The server collects `${...}` with any body and trims it, so a narrower
    // pattern here would report a configured integration as having no
    // placeholder and would fail to name the secret the importer must set.
    expect(
      secretRefsIn({
        a: '${TOKEN_ACME-1}',
        b: '${github.token}',
        c: '${ PADDED }',
      }),
    ).toEqual(['PADDED', 'TOKEN_ACME-1', 'github.token']);
  });

  it('ignores an empty placeholder', () => {
    expect(secretRefsIn({ a: '${}', b: '${  }' })).toEqual([]);
  });
});

describe('manifestPath', () => {
  it('maps kind to its directory', () => {
    expect(manifestPath('RelationshipRule', 'repo-owner')).toBe(
      'relationship-rules/repo-owner.yaml',
    );
  });
});
