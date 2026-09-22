/*
 * Copyright 2026 Larder Software Limited
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

import type { SecretResolver } from './secretStore';

const REF_PATTERN = /\$\{([^}]+)\}/g;

export function extractSecretRefs(value: string): string[] {
  const refs = new Set<string>();
  let match: RegExpExecArray | null;
  REF_PATTERN.lastIndex = 0;
  while ((match = REF_PATTERN.exec(value)) !== null) {
    refs.add(match[1]);
  }
  return [...refs];
}

/**
 * Replace every `${REF}` occurrence in the given string with the value
 * resolved from the resolver. References not in the allowList are
 * rejected with an error identical in wording to the previous
 * `substituteEnvVars` implementation so that existing callers observe
 * the same user-facing messages.
 *
 * Resolves all refs in a single batched `resolve([...])` call so that
 * scope-aware backends pay at most one round-trip per string.
 */
export async function substituteSecrets(
  value: string,
  resolver: SecretResolver,
  allowList: Set<string>,
): Promise<string> {
  if (!value.includes('${')) {
    return value;
  }

  const refs = extractSecretRefs(value);
  for (const ref of refs) {
    if (!allowList.has(ref)) {
      throw new Error(
        'Secret substitution not permitted for the referenced variable.',
      );
    }
  }

  const resolved = refs.length > 0 ? await resolver.resolve(refs) : {};

  return value.replace(REF_PATTERN, (_match, ref: string) => {
    const resolvedValue = resolved[ref];
    if (resolvedValue === undefined) {
      throw new Error(
        'Referenced secret is not set. Ensure it is configured first.',
      );
    }
    return resolvedValue;
  });
}
