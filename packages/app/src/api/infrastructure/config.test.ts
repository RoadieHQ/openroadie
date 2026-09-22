import { describe, it, expect } from 'vitest';
import {
  resolveRelationshipsSuggestionProducer,
  type AppConfig,
} from './config';

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    app: {
      title: 'OpenRoadie',
      baseUrl: 'http://localhost:3333',
    },
    backend: {
      baseUrl: 'http://localhost:7008',
    },
    ...overrides,
  };
}

describe('resolveRelationshipsSuggestionProducer', () => {
  it('defaults to api when relationships config is missing', () => {
    const config = createConfig();
    expect(resolveRelationshipsSuggestionProducer(config)).toBe('api');
  });

  it('defaults to api when relationships config is invalid', () => {
    const config = createConfig({
      relationships: {
        suggestionProducer: 'invalid' as unknown as 'api',
      },
    });
    expect(resolveRelationshipsSuggestionProducer(config)).toBe('api');
  });

  it('returns ai when explicitly configured', () => {
    const config = createConfig({
      relationships: { suggestionProducer: 'ai' },
    });
    expect(resolveRelationshipsSuggestionProducer(config)).toBe('ai');
  });

  it('returns api when explicitly configured', () => {
    const config = createConfig({
      relationships: { suggestionProducer: 'api' },
    });
    expect(resolveRelationshipsSuggestionProducer(config)).toBe('api');
  });
});
