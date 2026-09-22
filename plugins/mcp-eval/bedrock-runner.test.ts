import { describe, expect, it } from 'vitest';
import { BEDROCK_MODELS, calculateBedrockCost } from './bedrock-runner';

describe('calculateBedrockCost', () => {
  it('uses the configured input and output rates', () => {
    expect(
      calculateBedrockCost('qwen.qwen3-235b-a22b-2507-v1:0', 1_000, 500),
    ).toBe(0.001025);
  });

  it('rejects models without verified pricing', () => {
    expect(() => calculateBedrockCost('unknown', 1, 1)).toThrow(
      'No Bedrock pricing configured for unknown.',
    );
  });

  it('keeps every selectable model tied to a region and positive rates', () => {
    for (const config of BEDROCK_MODELS.values()) {
      expect(config.region).not.toBe('');
      expect(config.inputPricePerMillion).toBeGreaterThan(0);
      expect(config.outputPricePerMillion).toBeGreaterThan(0);
    }
  });
});
