import { describe, expect, it } from 'vitest';
import { getResourceModelJsonError } from './resource-model-json';

describe('getResourceModelJsonError', () => {
  it('allows empty or whitespace-only values', () => {
    expect(getResourceModelJsonError(undefined)).toBeUndefined();
    expect(getResourceModelJsonError('')).toBeUndefined();
    expect(getResourceModelJsonError('   \n')).toBeUndefined();
  });

  it('allows valid JSON', () => {
    expect(getResourceModelJsonError('{}')).toBeUndefined();
    expect(getResourceModelJsonError('{"Tags":[]}')).toBeUndefined();
  });

  it('rejects invalid JSON with no recoverable template placeholders', () => {
    expect(getResourceModelJsonError('{')).toBe('Invalid JSON');
    expect(getResourceModelJsonError('not-json')).toBe('Invalid JSON');
  });

  it('allows JSON after replacing {{ }} placeholders with string stubs', () => {
    expect(
      getResourceModelJsonError('{"RestApiId": "{{apiId}}" }'),
    ).toBeUndefined();
  });
});
