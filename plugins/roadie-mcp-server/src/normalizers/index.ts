import type { HarnessNormalizer } from './types';
import { claudeCodeNormalizer } from './claude-code';
import { codexNormalizer } from './codex';
import { cursorNormalizer } from './cursor';
import { opencodeNormalizer } from './opencode';

export type { HarnessNormalizer, NormalizedSessionEvent } from './types';

const normalizers: HarnessNormalizer[] = [
  claudeCodeNormalizer,
  codexNormalizer,
  cursorNormalizer,
  opencodeNormalizer,
];

const normalizersByHarness = new Map<string, HarnessNormalizer>(
  normalizers.map(n => [n.harness, n]),
);

export function getNormalizer(harness: string): HarnessNormalizer | undefined {
  return normalizersByHarness.get(harness);
}

export function getSupportedHarnesses(): string[] {
  return normalizers.map(n => n.harness);
}
