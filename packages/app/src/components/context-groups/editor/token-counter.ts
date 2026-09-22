import { getEncoding } from 'js-tiktoken';

export interface TokenRange {
  min: number;
  max: number;
  isHigh: boolean;
}

const HIGH_TOKEN_THRESHOLD = 8000;

let encoder: ReturnType<typeof getEncoding> | null = null;

function getEncoder() {
  if (!encoder) {
    encoder = getEncoding('cl100k_base');
  }
  return encoder;
}

export function countTokenRange(text: string): TokenRange {
  const count = getEncoder().encode(text).length;

  return {
    min: count,
    max: count,
    isHigh: count >= HIGH_TOKEN_THRESHOLD,
  };
}

export function formatTokenRange(range: TokenRange): string {
  if (range.min === range.max) {
    return `~${range.min.toLocaleString()}`;
  }
  return `~${range.min.toLocaleString()} → ${range.max.toLocaleString()}`;
}
