/*
 * Copyright 2024 Larder Software Ltd.
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

const PEM_BLOCK_PATTERN =
  /(-----BEGIN [^-]+-----)\s*([A-Za-z0-9+/=\s]+?)\s*(-----END [^-]+-----)/g;

function normalizePemLineEndingsAndEscapes(raw: string): string {
  return raw
    .trim()
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function normalizePemCertificate(raw: string): string {
  const value = normalizePemLineEndingsAndEscapes(raw);

  const normalizedPemBlocks = value.replace(
    PEM_BLOCK_PATTERN,
    (_match, header: string, bodyRaw: string, footer: string) => {
      const body = bodyRaw.replace(/\s+/g, '');
      const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body;
      return `${header}\n${wrapped}\n${footer}`;
    },
  );

  return normalizedPemBlocks
    .replace(/(-----END [^-]+-----)\s+(?=-----BEGIN [^-]+-----)/g, '$1\n')
    .trim();
}

export function normalizePrivateKey(raw: string): string {
  const value = normalizePemLineEndingsAndEscapes(raw);

  if (value.includes('\n')) {
    return value;
  }

  const flattenedMatch = value.match(
    /^(-----BEGIN [^-]+-----)\s+([A-Za-z0-9+/=\s]+?)\s+(-----END [^-]+-----)$/,
  );

  if (flattenedMatch) {
    const [, header, bodyRaw, footer] = flattenedMatch;
    const body = bodyRaw.replace(/\s+/g, '');
    const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body;
    return `${header}\n${wrapped}\n${footer}`;
  }

  return value;
}
