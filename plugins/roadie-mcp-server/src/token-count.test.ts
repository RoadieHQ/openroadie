import { countTokens } from './token-count';

describe('countTokens', () => {
  it('should return undefined for null/undefined/empty input', () => {
    expect(countTokens(undefined)).toBeUndefined();
    expect(countTokens(null)).toBeUndefined();
    expect(countTokens('')).toBeUndefined();
  });

  it('should count tokens for a string', () => {
    const count = countTokens('hello world');
    expect(count).toBeGreaterThan(0);
  });

  it('should serialise objects before counting', () => {
    const count = countTokens({ query: 'pods', limit: 10 });
    expect(count).toBeGreaterThan(0);
  });

  it('should count arrays of content blocks', () => {
    const count = countTokens([{ type: 'text', text: 'result body' }]);
    expect(count).toBeGreaterThan(0);
  });
});
