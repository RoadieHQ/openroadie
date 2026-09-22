import { describe, expect, it } from 'vitest';
import { humanizeRelationshipType } from './humanize-relationship-type';

describe('humanizeRelationshipType', () => {
  it('splits camelCase and capitalizes only the first word', () => {
    expect(humanizeRelationshipType('dependsOn')).toBe('Depends on');
    expect(humanizeRelationshipType('hasDependency')).toBe('Has dependency');
  });

  it('fixes up known acronyms wherever they appear', () => {
    expect(humanizeRelationshipType('builtFromGithubRepository')).toBe(
      'Built from GitHub repository',
    );
    expect(humanizeRelationshipType('deployedToEcr')).toBe('Deployed to ECR');
    expect(humanizeRelationshipType('storedInAws')).toBe('Stored in AWS');
    expect(humanizeRelationshipType('exposesApi')).toBe('Exposes API');
  });

  it('capitalizes an acronym even when it is the first word', () => {
    expect(humanizeRelationshipType('githubRepositoryOf')).toBe(
      'GitHub repository of',
    );
    expect(humanizeRelationshipType('apiConsumedBy')).toBe('API consumed by');
  });

  it('treats a bare acronym as an ID rather than title-casing it', () => {
    expect(humanizeRelationshipType('id')).toBe('ID');
    expect(humanizeRelationshipType('url')).toBe('URL');
  });

  it('splits consecutive capitals from a following word', () => {
    // "HTTPSProxy" → "HTTPS Proxy": the acronym is preserved and the trailing
    // word is broken off rather than glued on.
    expect(humanizeRelationshipType('HTTPSProxy')).toBe('HTTPS proxy');
  });

  it('normalizes snake_case, kebab-case, and dotted separators', () => {
    expect(humanizeRelationshipType('depends_on')).toBe('Depends on');
    expect(humanizeRelationshipType('depends-on')).toBe('Depends on');
    expect(humanizeRelationshipType('depends.on')).toBe('Depends on');
    expect(humanizeRelationshipType('built_from_github_repository')).toBe(
      'Built from GitHub repository',
    );
  });

  it('collapses runs of mixed separators and whitespace', () => {
    expect(humanizeRelationshipType('depends__on')).toBe('Depends on');
    expect(humanizeRelationshipType('  depends   on  ')).toBe('Depends on');
    expect(humanizeRelationshipType('depends - on')).toBe('Depends on');
  });

  it('lower-cases an all-caps non-acronym word after the first', () => {
    expect(humanizeRelationshipType('ownedBy')).toBe('Owned by');
  });

  it('keeps digits attached and splits before a following capital', () => {
    expect(humanizeRelationshipType('s3Bucket')).toBe('S3 bucket');
  });

  it('falls back to the trimmed original when there are no word characters', () => {
    expect(humanizeRelationshipType('')).toBe('');
    expect(humanizeRelationshipType('   ')).toBe('');
    expect(humanizeRelationshipType('___')).toBe('___');
  });
});
