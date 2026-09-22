/*
 * Copyright 2026 Larder Software Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { getEncoding } from 'js-tiktoken';

// MCP tool calls don't carry real LLM token usage, so we approximate the
// input/output size with the same cl100k_base tokenizer the frontend uses
// (context-groups token counter) to keep the numbers comparable.
let encoder: ReturnType<typeof getEncoding> | null = null;

function getEncoder() {
  if (!encoder) {
    encoder = getEncoding('cl100k_base');
  }
  return encoder;
}

/**
 * Approximate token count of an arbitrary JSON-serialisable value. Returns
 * undefined for empty input and never throws — a tokenizer failure must not
 * break a tool call.
 */
export function countTokens(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return undefined;
  try {
    return getEncoder().encode(text).length;
  } catch {
    return undefined;
  }
}
