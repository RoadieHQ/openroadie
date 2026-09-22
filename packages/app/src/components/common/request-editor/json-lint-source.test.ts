import { jsonLintSource } from './json-lint-source';

function fakeView(text: string) {
  return {
    state: {
      doc: {
        length: text.length,
        toString: () => text,
        // jsonParseLinter may use these to locate the error position
        lineAt: (_pos: number) => ({ from: 0 }),
        line: (_n: number) => ({ from: 0 }),
      },
    },
  } as any;
}

describe('jsonLintSource', () => {
  it('returns no diagnostics for an empty document', () => {
    expect(jsonLintSource(fakeView(''))).toEqual([]);
  });

  it('returns no diagnostics for valid JSON', () => {
    expect(jsonLintSource(fakeView('{"a": 1}'))).toEqual([]);
  });

  it('returns a diagnostic for malformed JSON', () => {
    const diagnostics = jsonLintSource(fakeView('{oops'));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
  });
});
