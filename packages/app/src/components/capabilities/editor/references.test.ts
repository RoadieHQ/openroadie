import { extractReferences } from './references';

describe('extractReferences', () => {
  it('returns nothing for empty or reference-free text', () => {
    expect(extractReferences('')).toEqual([]);
    expect(extractReferences('Just some plain instructions.')).toEqual([]);
  });

  it('parses each reference type', () => {
    const text =
      'Use @datasource:sentry-projects and @action:create-repo with @context-group:payments-team.';
    expect(extractReferences(text)).toEqual([
      { type: 'datasource', slug: 'sentry-projects' },
      { type: 'action', slug: 'create-repo' },
      { type: 'context-group', slug: 'payments-team' },
    ]);
  });

  it('de-duplicates repeated references', () => {
    const text = '@action:deploy then @action:deploy again';
    expect(extractReferences(text)).toEqual([
      { type: 'action', slug: 'deploy' },
    ]);
  });

  it('ignores malformed tokens', () => {
    // Unknown type, empty slug, and uppercase slug are all rejected by the
    // slug grammar shared with the backend.
    const text = '@unknown:thing @datasource: @action:UPPER @datasource:ok';
    expect(extractReferences(text)).toEqual([
      { type: 'datasource', slug: 'ok' },
    ]);
  });
});
